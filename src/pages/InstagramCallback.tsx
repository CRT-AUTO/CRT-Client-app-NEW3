import React, { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { supabase, getSessionWithRetry } from '../lib/supabase';
import { MessageSquare, AlertCircle, Instagram, RefreshCw } from 'lucide-react';
import { restoreFacebookAuthState, getNetlifyFunctionsBaseUrl } from '../lib/facebookAuth';

export default function InstagramCallback() {
  const [error, setError] = useState<string | null>(null);
  const [processing, setProcessing] = useState(true);
  const [status, setStatus] = useState<'processing' | 'auth_restore' | 'exchanging_code' | 'getting_accounts' | 'saving' | 'success' | 'error'>('processing');
  const [debugInfo, setDebugInfo] = useState<string[]>([]);
  const [authRestoreAttempted, setAuthRestoreAttempted] = useState(false);
  const [sessionCheckFailed, setSessionCheckFailed] = useState(false);
  const [restoreAttemptCount, setRestoreAttemptCount] = useState(0);
  const [maxAttempts] = useState(3);
  const location = useLocation();
  const navigate = useNavigate();

  const addDebugInfo = (message: string) => {
    console.log(message);
    setDebugInfo(prev => [...prev, `${new Date().toISOString().slice(11, 19)}: ${message}`]);
  };

  // First, attempt to restore authentication state
  useEffect(() => {
    const restoreAuth = async () => {
      if (authRestoreAttempted || restoreAttemptCount >= maxAttempts) return;
      
      addDebugInfo('Attempting to restore authentication state');
      setStatus('auth_restore');
      setRestoreAttemptCount(prev => prev + 1);
      
      // Check if we have saved auth state
      const savedState = localStorage.getItem('fb_auth_state');
      if (savedState) {
        try {
          const parsedState = JSON.parse(savedState);
          addDebugInfo(`Found saved auth state for user ${parsedState.userId?.slice(0, 8) || 'unknown'}...`);
          
          // Check if state is recent enough
          const stateAgeMinutes = (Date.now() - parsedState.timestamp) / (60 * 1000);
          if (stateAgeMinutes > 15) {
            localStorage.removeItem('fb_auth_state');
            addDebugInfo('Auth state too old, removed it');
          }
        } catch (e) {
          localStorage.removeItem('fb_auth_state');
          addDebugInfo(`Error parsing auth state: ${e instanceof Error ? e.message : 'Unknown error'}`);
        }
      }
      
      // Try to get session with enhanced retry logic
      try {
        addDebugInfo('Checking for existing session with retry mechanism');
        const { data: { session } } = await getSessionWithRetry(20000, 1000); // Increased timeout for Instagram
        
        if (session) {
          addDebugInfo(`Already authenticated as ${session.user.email || session.user.id}`);
          setAuthRestoreAttempted(true);
          return;
        }
      } catch (sessionTimeoutError) {
        addDebugInfo(`Session check with retry failed: ${sessionTimeoutError instanceof Error ? sessionTimeoutError.message : 'Unknown error'}`);
        setSessionCheckFailed(true);
      }
      
      try {
        const restored = await restoreFacebookAuthState();
        
        if (restored) {
          addDebugInfo('Authentication state restored successfully');
        } else {
          addDebugInfo('Could not restore auth state, will attempt to continue anyway');
          
          // We might need to redirect back to auth
          if (!sessionCheckFailed && restoreAttemptCount >= maxAttempts) {
            addDebugInfo('No active session, redirecting to auth page in 5 seconds...');
            setTimeout(() => {
              navigate('/auth', { 
                state: { 
                  message: 'Session expired. Please log in again to complete Instagram connection.',
                  fromOAuth: true 
                } 
              });
            }, 5000);
          }
        }
      } catch (error) {
        addDebugInfo(`Error restoring auth state: ${error instanceof Error ? error.message : 'Unknown error'}`);
      } finally {
        setAuthRestoreAttempted(true);
      }
    };
    
    restoreAuth();
  }, [navigate, authRestoreAttempted, maxAttempts, restoreAttemptCount, sessionCheckFailed]);

  // Process the Instagram callback once auth restore is attempted
  useEffect(() => {
    // If we're still trying to restore auth, skip processing the callback
    if (!authRestoreAttempted) return;
    
    async function handleInstagramCallback() {
      try {
        // Extract code from URL
        const params = new URLSearchParams(location.search);
        const code = params.get('code');
        
        if (!code) {
          throw new Error('Authorization code not found');
        }

        addDebugInfo(`Processing Instagram callback with code: ${code.substring(0, 10)}...`);
        setStatus('processing');

        // Get the current user
        let userData;
        try {
          const { data, error: userError } = await supabase.auth.getUser();
          if (userError) {
            addDebugInfo(`Error getting user: ${userError.message}`);
            throw userError;
          }
          
          if (!data.user) {
            addDebugInfo('User not authenticated');
            
            // If session check failed, try to use saved state
            if (sessionCheckFailed) {
              const savedState = localStorage.getItem('fb_auth_state');
              if (savedState) {
                try {
                  const parsedState = JSON.parse(savedState);
                  addDebugInfo(`Using saved user ID from auth state: ${parsedState.userId?.slice(0, 8) || 'unknown'}...`);
                  userData = { user: { id: parsedState.userId } };
                } catch (parseError) {
                  throw new Error('User not authenticated and could not restore from saved state');
                }
              } else {
                throw new Error('User not authenticated and no saved state found');
              }
            } else {
              throw new Error('User not authenticated');
            }
          } else {
            userData = data;
          }
        } catch (userError) {
          // Try to get user ID from saved state
          const savedState = localStorage.getItem('fb_auth_state');
          if (!savedState) {
            throw new Error('User not authenticated and no saved state found');
          }
          
          try {
            const parsedState = JSON.parse(savedState);
            if (!parsedState.userId) {
              throw new Error('Invalid saved state: missing userId');
            }
            addDebugInfo(`Using user ID from saved state: ${parsedState.userId.slice(0, 8)}...`);
            userData = { user: { id: parsedState.userId } };
          } catch (parseError) {
            throw new Error('User not authenticated and could not restore from saved state');
          }
        }

        const userId = userData.user.id;
        addDebugInfo(`Using user ID: ${userId}`);

        // Exchange code for token using our Netlify function
        setStatus('exchanging_code');
        addDebugInfo('Exchanging authorization code for access token...');
        
        // Get the base URL for Netlify functions
        const functionsBaseUrl = getNetlifyFunctionsBaseUrl();
        const exchangeUrl = `${functionsBaseUrl}/exchangeToken?code=${code}`;
        
        addDebugInfo(`Making fetch request to: ${exchangeUrl}`);
        
        const exchangeResponse = await fetch(exchangeUrl, {
          method: 'GET',
          mode: 'cors',
          credentials: 'same-origin',
          headers: {
            'Accept': 'application/json'
          }
        });
        
        if (!exchangeResponse.ok) {
          const errorText = await exchangeResponse.text();
          addDebugInfo(`Token exchange failed with status: ${exchangeResponse.status}, response: ${errorText}`);
          
          try {
            const errorData = JSON.parse(errorText);
            throw new Error(`Token exchange failed: ${errorData.error || 'Unknown error'}`);
          } catch (jsonError) {
            throw new Error(`Token exchange failed with status ${exchangeResponse.status}: ${errorText}`);
          }
        }
        
        const tokenData = await exchangeResponse.json();
        
        if (!tokenData.accessToken) {
          throw new Error('No access token returned from server');
        }
        
        addDebugInfo('Successfully received access token');
        
        // Now get the Instagram business account connected to the user's Facebook page
        setStatus('getting_accounts');
        addDebugInfo('Getting Facebook pages and Instagram accounts...');
        
        const pages = tokenData.pages || [];
        
        if (pages.length === 0) {
          addDebugInfo('No Facebook pages found. Attempting to fetch pages directly...');
          
          try {
            const pagesResponse = await fetch(`${functionsBaseUrl}/getPageToken?token=${tokenData.accessToken}&pageId=me/accounts`, {
              method: 'GET',
              mode: 'cors',
              credentials: 'same-origin',
              headers: {
                'Accept': 'application/json'
              }
            });
            
            if (!pagesResponse.ok) {
              const pageError = await pagesResponse.json();
              addDebugInfo(`Error fetching pages: ${pageError.error || 'Unknown error'}`);
            } else {
              const pagesData = await pagesResponse.json();
              if (pagesData.pages && pagesData.pages.length > 0) {
                addDebugInfo(`Found ${pagesData.pages.length} Facebook pages`);
                pages.push(...pagesData.pages);
              }
            }
          } catch (pageError) {
            addDebugInfo(`Exception fetching pages: ${pageError instanceof Error ? pageError.message : 'Unknown error'}`);
          }
        }
        
        if (pages.length === 0) {
          throw new Error('No Facebook pages available. Please create a Facebook page first.');
        }
        
        // For each page, check if it has an Instagram business account
        let instagramAccount = null;
        
        for (const page of pages) {
          try {
            addDebugInfo(`Checking Instagram accounts for page: ${page.name || page.id}`);
            
            const igResponse = await fetch(`${functionsBaseUrl}/getInstagramAccounts?token=${tokenData.accessToken}&pageId=${page.id}`, {
              method: 'GET',
              mode: 'cors',
              credentials: 'same-origin',
              headers: {
                'Accept': 'application/json'
              }
            });
            
            if (igResponse.ok) {
              const igData = await igResponse.json();
              
              if (igData.instagramAccount) {
                addDebugInfo(`Found Instagram business account: ${igData.instagramAccount.username || igData.instagramAccount.id}`);
                instagramAccount = igData.instagramAccount;
                break;
              }
            }
          } catch (igError) {
            addDebugInfo(`Error checking Instagram for page ${page.id}: ${igError instanceof Error ? igError.message : 'Unknown error'}`);
            // Continue to next page
          }
        }
        
        if (!instagramAccount) {
          throw new Error('No Instagram business accounts found. Please connect an Instagram business account to one of your Facebook pages.');
        }
        
        // Get long-lived token for the page that owns the Instagram account
        addDebugInfo('Getting long-lived token...');
        const longLivedTokenResponse = await fetch(`${functionsBaseUrl}/getLongLivedToken?token=${tokenData.accessToken}`, {
          method: 'GET',
          mode: 'cors',
          credentials: 'same-origin',
          headers: {
            'Accept': 'application/json'
          }
        });
        
        if (!longLivedTokenResponse.ok) {
          const tokenError = await longLivedTokenResponse.json();
          throw new Error(`Failed to get long-lived token: ${tokenError.error || 'Unknown error'}`);
        }
        
        const longLivedTokenData = await longLivedTokenResponse.json();
        
        if (!longLivedTokenData.accessToken) {
          throw new Error('No long-lived access token returned from server');
        }
        
        // Calculate token expiry date - use 60 days if not specified
        const expiryDate = longLivedTokenData.expiryDate || 
                          new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString();
        
        // Save connection to database
        setStatus('saving');
        addDebugInfo('Saving Instagram connection to database...');
        
        try {
          // Check for existing connection
          const { data: existingConnections, error: connectionError } = await supabase
            .from('social_connections')
            .select('*')
            .eq('user_id', userId)
            .eq('ig_account_id', instagramAccount.id);
            
          if (connectionError) {
            addDebugInfo(`Error checking existing connections: ${connectionError.message}`);
            throw connectionError;
          }
          
          if (existingConnections && existingConnections.length > 0) {
            // Update existing connection
            addDebugInfo('Updating existing Instagram connection');
            const { error: updateError } = await supabase
              .from('social_connections')
              .update({
                access_token: longLivedTokenData.accessToken,
                token_expiry: expiryDate,
                refreshed_at: new Date().toISOString()
              })
              .eq('id', existingConnections[0].id);
              
            if (updateError) {
              addDebugInfo(`Error updating connection: ${updateError.message}`);
              throw updateError;
            }
          } else {
            // Create new connection
            addDebugInfo('Creating new Instagram connection');
            const { error: insertError } = await supabase
              .from('social_connections')
              .insert({
                user_id: userId,
                ig_account_id: instagramAccount.id,
                access_token: longLivedTokenData.accessToken,
                token_expiry: expiryDate
              });
              
            if (insertError) {
              addDebugInfo(`Error creating connection: ${insertError.message}`);
              throw insertError;
            }
          }
        } catch (dbError) {
          // Handle database errors
          addDebugInfo(`Database operation failed: ${dbError instanceof Error ? dbError.message : 'Unknown error'}`);
          
          // Special case: If we're in a 2FA flow and can't authenticate properly,
          // we might not be able to save the connection
          if (sessionCheckFailed) {
            addDebugInfo('Session check failed and we are likely in a 2FA flow.');
            addDebugInfo('Consider redirecting user to login again after 2FA completion.');
            
            // Provide clearer error message for 2FA scenario
            throw new Error('Could not save connection due to authentication issues. Please log in again after completing two-factor authentication.');
          }
          
          throw dbError;
        }
        
        // Clean up storage
        localStorage.removeItem('fb_auth_state');
        
        addDebugInfo('Instagram connection saved successfully');
        setStatus('success');
        
        // Success! Wait a moment then redirect
        setTimeout(() => {
          navigate('/settings', { replace: true });
        }, 2000);
        
      } catch (err) {
        console.error('Instagram OAuth Error:', err);
        addDebugInfo(`Instagram OAuth Error: ${err instanceof Error ? err.message : 'Unknown error'}`);
        
        // Special handling for 2FA-related errors
        if (err instanceof Error && (
            err.message.includes('two-factor') || 
            err.message.includes('2FA') || 
            err.message.includes('authentication')
        )) {
          setError('Facebook requires two-factor authentication. Please complete the 2FA process and try again.');
        } else {
          setError('Failed to connect your Instagram account. Please try again.');
        }
        
        setStatus('error');
        setProcessing(false);
      }
    }

    handleInstagramCallback();
  }, [location, navigate, authRestoreAttempted, sessionCheckFailed]);

  // Function to retry the entire process
  const handleRetry = () => {
    // Reset all state
    setAuthRestoreAttempted(false);
    setRestoreAttemptCount(0);
    setSessionCheckFailed(false);
    setStatus('processing');
    setError(null);
    setProcessing(true);
  };

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col justify-center py-12 sm:px-6 lg:px-8">
      <div className="sm:mx-auto sm:w-full sm:max-w-md">
        <div className="flex justify-center">
          <MessageSquare className="h-12 w-12 text-indigo-600" />
        </div>
        <h2 className="mt-6 text-center text-3xl font-extrabold text-gray-900">
          Connecting Instagram
        </h2>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
        <div className="bg-white py-8 px-4 shadow sm:rounded-lg sm:px-10 text-center">
          {status === 'processing' || status === 'auth_restore' || status === 'exchanging_code' || status === 'getting_accounts' || status === 'saving' ? (
            <>
              <div className="flex justify-center mb-4">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600"></div>
              </div>
              <p className="text-gray-700">
                {status === 'processing' && 'Processing your Instagram connection...'}
                {status === 'auth_restore' && 'Restoring your authentication session...'}
                {status === 'exchanging_code' && 'Exchanging authorization code for access token...'}
                {status === 'getting_accounts' && 'Retrieving your Instagram business accounts...'}
                {status === 'saving' && 'Saving your Instagram account connection...'}
              </p>
              <p className="text-sm text-gray-500 mt-2">
                This might take a moment.
              </p>
              
              {sessionCheckFailed && (
                <div className="mt-4 p-3 bg-yellow-50 border border-yellow-200 rounded-md">
                  <p className="flex items-center text-sm text-yellow-700">
                    <AlertCircle className="h-4 w-4 mr-1" />
                    It looks like Facebook might be requiring two-factor authentication.
                  </p>
                  <p className="mt-1 text-xs text-yellow-600">
                    If you're completing 2FA on Facebook, please wait while we process your connection.
                  </p>
                </div>
              )}
            </>
          ) : status === 'error' ? (
            <>
              <div className="flex justify-center mb-4">
                <AlertCircle className="h-12 w-12 text-red-500" />
              </div>
              <div className="bg-red-50 border border-red-200 text-red-600 px-4 py-3 mb-4 rounded-md text-sm">
                {error}
              </div>
              
              <div className="mt-4 flex flex-col sm:flex-row gap-2 justify-center">
                <button
                  onClick={handleRetry}
                  className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
                >
                  <RefreshCw className="h-4 w-4 mr-2" />
                  Try Again
                </button>
                
                <button
                  onClick={() => navigate('/settings')}
                  className="inline-flex items-center px-4 py-2 border border-gray-300 text-sm font-medium rounded-md shadow-sm text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
                >
                  Go Back to Settings
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="flex justify-center mb-4">
                <Instagram className="h-12 w-12 text-pink-600" />
              </div>
              <div className="bg-green-50 border border-green-200 text-green-600 px-4 py-3 mb-4 rounded-md text-sm">
                Successfully connected to Instagram!
              </div>
              <p className="text-gray-700 mb-4">Redirecting you back to settings...</p>
            </>
          )}
          
          {/* Debug info section */}
          {debugInfo.length > 0 && (
            <div className="mt-6 p-3 bg-gray-50 rounded-md text-left">
              <div className="flex justify-between items-center">
                <p className="text-xs text-gray-500 font-semibold">Debug Information:</p>
                <button 
                  onClick={() => navigator.clipboard.writeText(JSON.stringify(debugInfo, null, 2))}
                  className="text-xs text-indigo-600 hover:underline"
                >
                  Copy
                </button>
              </div>
              <div className="text-xs text-gray-500 max-h-60 overflow-y-auto mt-1 space-y-1">
                {debugInfo.map((info, idx) => (
                  <div key={idx} className="bg-white p-1 rounded">{info}</div>
                ))}
              </div>
            </div>
          )}

          {/* Manual navigation option if stuck */}
          {(status === 'auth_restore' || status === 'processing') && debugInfo.length > 5 && (
            <div className="mt-4">
              <button
                onClick={() => navigate('/auth')}
                className="px-3 py-1 text-sm text-indigo-600 hover:text-indigo-500 border border-indigo-200 rounded"
              >
                Taking too long? Go to login page
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}