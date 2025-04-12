import React, { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { supabase, getSessionWithRetry } from '../lib/supabase';
import { MessageSquare, AlertCircle, Facebook, RefreshCw } from 'lucide-react';
import { restoreFacebookAuthState, is2FAError, getNetlifyFunctionsBaseUrl } from '../lib/facebookAuth';

// Type definition for Facebook Page
interface FacebookPage {
  id: string;
  name: string;
  access_token: string;
  category: string;
}

export default function FacebookCallback() {
  const [error, setError] = useState<string | null>(null);
  const [processing, setProcessing] = useState(true);
  const [status, setStatus] = useState<'processing' | 'auth_restore' | 'exchanging_code' | 'getting_pages' | 'saving' | 'success' | 'error'>('processing');
  const [debugInfo, setDebugInfo] = useState<string[]>([]);
  const [selectedPageId, setSelectedPageId] = useState<string | null>(null);
  const [availablePages, setAvailablePages] = useState<FacebookPage[]>([]);
  const [authRestoreAttempted, setAuthRestoreAttempted] = useState(false);
  const [maxAttempts] = useState(3); // Maximum number of auth restore attempts
  const [restoreAttemptCount, setRestoreAttemptCount] = useState(0);
  const [sessionCheckFailed, setSessionCheckFailed] = useState(false);
  const [noPageDetected, setNoPageDetected] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();

  const addDebugInfo = (message: string) => {
    console.log(message);
    setDebugInfo(prev => [...prev, `${new Date().toISOString().slice(11, 19)}: ${message}`]);
  };

  // Check for OAuth cancellation/errors in URL
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const error = params.get('error');
    const errorReason = params.get('error_reason');
    const errorDescription = params.get('error_description');
    
    if (error) {
      addDebugInfo(`OAuth error detected in URL: ${error}`);
      if (errorReason) addDebugInfo(`Error reason: ${errorReason}`);
      if (errorDescription) addDebugInfo(`Error description: ${errorDescription}`);
      
      setError(`Facebook login was cancelled or failed: ${errorDescription || errorReason || error}`);
      setStatus('error');
      setProcessing(false);
      return;
    }
  }, [location.search]);

  // First, attempt to restore authentication state
  useEffect(() => {
    const restoreAuth = async () => {
      // Only attempt restore a limited number of times
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
          
          // Check if the state is recent enough (less than 30 minutes old - increased from 15)
          const stateAgeMinutes = (Date.now() - parsedState.timestamp) / (60 * 1000);
          addDebugInfo(`Auth state is ${stateAgeMinutes.toFixed(1)} minutes old`);
          
          if (stateAgeMinutes > 30) {
            addDebugInfo('Auth state is too old, removing it');
            localStorage.removeItem('fb_auth_state');
          }
        } catch (e) {
          addDebugInfo(`Error parsing saved auth state: ${e instanceof Error ? e.message : 'Unknown error'}`);
          // Remove invalid state
          localStorage.removeItem('fb_auth_state');
        }
      } else {
        addDebugInfo('No saved auth state found');
      }
      
      // First check if we're already authenticated
      try {
        // Use enhanced session check with retry for 2FA scenarios - increased timeout to 30 seconds
        addDebugInfo('Checking for existing session with retry mechanism (30s timeout)');
        try {
          const { data: { session } } = await getSessionWithRetry(30000, 1500); // Increased to 30 seconds for 2FA
          
          if (session) {
            addDebugInfo(`Already authenticated as ${session.user.email || session.user.id}`);
            setAuthRestoreAttempted(true);
            return;
          }
        } catch (sessionTimeoutError) {
          addDebugInfo(`Session check with retry failed: ${sessionTimeoutError instanceof Error ? sessionTimeoutError.message : 'Unknown error'}`);
          setSessionCheckFailed(true);
        }

        addDebugInfo('No active session found, attempting to restore');
        
        try {
          const restored = await restoreFacebookAuthState();
          
          if (restored) {
            addDebugInfo('Authentication state restored successfully');
            setAuthRestoreAttempted(true);
          } else {
            addDebugInfo('Could not restore authentication state, will attempt to continue anyway');
            
            // We'll still proceed with the token exchange even without a session
            setAuthRestoreAttempted(true);
          }
        } catch (restoreError) {
          addDebugInfo(`Error restoring auth state: ${restoreError instanceof Error ? restoreError.message : 'Unknown error'}`);
          
          // If we've reached max attempts, redirect to auth
          if (restoreAttemptCount >= maxAttempts) {
            addDebugInfo(`Max restore attempts (${maxAttempts}) reached, but will still attempt to continue`);
            setAuthRestoreAttempted(true); // Continue anyway as a last resort
          } else {
            // Try again after a delay
            setTimeout(() => {
              setAuthRestoreAttempted(false);  // Reset flag to retry
            }, 1500);
          }
        }
      } catch (sessionError) {
        addDebugInfo(`Session check error: ${sessionError instanceof Error ? sessionError.message : 'Unknown error'}`);
        // If there's an error checking the session, try to continue anyway
        setAuthRestoreAttempted(true);
      }
    };
    
    restoreAuth();
  }, [navigate, authRestoreAttempted, restoreAttemptCount, maxAttempts]);

  // Then process the Facebook callback once auth restore is attempted
  useEffect(() => {
    // If we're still trying to restore auth, skip processing the callback
    if (!authRestoreAttempted) return;
    
    async function handleFacebookCallback() {
      try {
        // Extract code from URL
        const params = new URLSearchParams(location.search);
        const code = params.get('code');
        
        if (!code) {
          throw new Error('Authorization code not found');
        }

        addDebugInfo(`Processing Facebook callback with code: ${code.substring(0, 10)}...`);
        setStatus('processing');

        // Special handling for possible 2FA scenario
        if (sessionCheckFailed) {
          addDebugInfo('Session check failed previously, which may indicate a 2FA flow');
          // We'll still attempt to proceed with the token exchange
        }

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
            // If session check failed and we can't get the user, this may be a 2FA flow
            // We'll try to restore from saved state
            if (sessionCheckFailed) {
              const savedState = localStorage.getItem('fb_auth_state');
              if (savedState) {
                try {
                  const parsedState = JSON.parse(savedState);
                  addDebugInfo(`Using saved user ID from auth state: ${parsedState.userId?.slice(0, 8) || 'unknown'}...`);
                  userData = { user: { id: parsedState.userId } };
                } catch (parseError) {
                  addDebugInfo(`Error parsing saved auth state: ${parseError instanceof Error ? parseError.message : 'Unknown error'}`);
                  throw new Error('User not authenticated and could not restore from saved state');
                }
              } else {
                throw new Error('User not authenticated');
              }
            } else {
              throw new Error('User not authenticated');
            }
          } else {
            userData = data;
          }
        } catch (userError) {
          addDebugInfo(`Error getting authenticated user: ${userError instanceof Error ? userError.message : 'Unknown error'}`);
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
            addDebugInfo(`Error parsing saved auth state: ${parseError instanceof Error ? parseError.message : 'Unknown error'}`);
            throw new Error('User not authenticated and could not restore from saved state');
          }
        }

        const userId = userData.user.id;
        addDebugInfo(`Authenticated as user ID: ${userId}`);

        // Exchange code for token using our Netlify function
        setStatus('exchanging_code');
        addDebugInfo('Exchanging authorization code for access token...');
        
        // Get the base URL for Netlify functions
        const functionsBaseUrl = getNetlifyFunctionsBaseUrl();
        const exchangeUrl = `${functionsBaseUrl}/exchangeToken?code=${code}`;
        
        addDebugInfo(`Making fetch request to: ${exchangeUrl}`);
        
        // Use fetch with explicit mode and credentials
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
        
        // Get available pages
        const pages = tokenData.pages || [];
        
        if (pages.length === 0) {
          addDebugInfo('No Facebook pages found in response. Fetching pages separately...');
          
          // If no pages were returned, try to get them using the page token function
          setStatus('getting_pages');
          
          try {
            const pageResponse = await fetch(`${functionsBaseUrl}/getPageToken?token=${tokenData.accessToken}&pageId=me/accounts`, {
              method: 'GET',
              mode: 'cors',
              credentials: 'same-origin',
              headers: {
                'Accept': 'application/json'
              }
            });
            
            if (pageResponse.ok) {
              const pageData = await pageResponse.json();
              if (pageData.pages && pageData.pages.length > 0) {
                pages.push(...pageData.pages);
                addDebugInfo(`Retrieved ${pageData.pages.length} Facebook pages`);
              }
            }
          } catch (pageError) {
            addDebugInfo(`Error fetching pages: ${pageError instanceof Error ? pageError.message : 'Unknown error'}`);
            // Continue even if page fetching fails
          }
        } else {
          addDebugInfo(`Found ${pages.length} Facebook pages`);
        }
        
        if (pages.length === 0) {
          addDebugInfo('No Facebook pages found. User needs to create a Facebook page first.');
          setNoPageDetected(true);
          throw new Error('No Facebook pages available for this account. Please create a Facebook page first, then try connecting again.');
        }
        
        // If we have exactly one page, use it directly
        let selectedPageId: string;
        let selectedPage: FacebookPage;
        
        if (pages.length === 1) {
          selectedPageId = pages[0].id;
          selectedPage = pages[0];
          addDebugInfo(`Auto-selected the only available page: ${selectedPage.name}`);
        } else if (pages.length > 1) {
          // In a real app, you would show UI for page selection
          selectedPageId = pages[0].id;
          selectedPage = pages[0];
          addDebugInfo(`Multiple pages available, selecting first one: ${selectedPage.name}`);
          // Save all pages to state in case we want to implement selection UI
          setAvailablePages(pages);
        } else {
          throw new Error('No Facebook pages available');
        }
        
        // Get long-lived page token
        addDebugInfo('Getting long-lived page token...');
        const pageTokenResponse = await fetch(`${functionsBaseUrl}/getPageToken?token=${tokenData.accessToken}&pageId=${selectedPageId}`, {
          method: 'GET',
          mode: 'cors',
          credentials: 'same-origin',
          headers: {
            'Accept': 'application/json'
          }
        });
        
        if (!pageTokenResponse.ok) {
          const pageTokenError = await pageTokenResponse.json();
          throw new Error(`Failed to get page token: ${pageTokenError.error || 'Unknown error'}`);
        }
        
        const pageTokenData = await pageTokenResponse.json();
        
        if (!pageTokenData.accessToken) {
          throw new Error('No page token returned from server');
        }
        
        const pageAccessToken = pageTokenData.accessToken;
        const expiryDate = pageTokenData.expiryDate || new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString(); // Default 60 days
        
        // Save to database
        setStatus('saving');
        addDebugInfo('Saving Facebook connection to database...');
        
        try {
          // Check for existing connection
          const { data: existingConnections, error: connectionError } = await supabase
            .from('social_connections')
            .select('*')
            .eq('user_id', userId)
            .eq('fb_page_id', selectedPageId);
            
          if (connectionError) {
            addDebugInfo(`Error checking existing connections: ${connectionError.message}`);
            throw connectionError;
          }
          
          if (existingConnections && existingConnections.length > 0) {
            // Update existing connection
            addDebugInfo('Updating existing Facebook connection');
            const { error: updateError } = await supabase
              .from('social_connections')
              .update({
                access_token: pageAccessToken,
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
            addDebugInfo('Creating new Facebook connection');
            const { error: insertError } = await supabase
              .from('social_connections')
              .insert({
                user_id: userId,
                fb_page_id: selectedPageId,
                access_token: pageAccessToken,
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
        localStorage.removeItem('fb_pages');
        localStorage.removeItem('fb_auth_state');
        
        addDebugInfo('Facebook connection saved successfully');
        setStatus('success');
        
        // Success! Wait a moment then redirect
        setTimeout(() => {
          navigate('/settings', { replace: true });
        }, 2000);
        
      } catch (err) {
        console.error('Facebook OAuth Error:', err);
        addDebugInfo(`Facebook OAuth Error: ${err instanceof Error ? err.message : 'Unknown error'}`);
        
        // Special handling for 2FA-related errors
        if (err instanceof Error && (
            err.message.includes('two-factor') || 
            err.message.includes('2FA') || 
            err.message.includes('authentication')
        )) {
          setError('Facebook requires two-factor authentication. Please complete the 2FA process and try again.');
        } else if (noPageDetected) {
          setError('No Facebook Pages found on your account. Please create a Facebook Page first, then try connecting again.');
        } else {
          setError('Failed to connect your Facebook account. Please try again.');
        }
        
        setStatus('error');
        setProcessing(false);
      }
    }

    handleFacebookCallback();
  }, [location, navigate, authRestoreAttempted, sessionCheckFailed, noPageDetected]);

  // Function to retry the entire process
  const handleRetry = () => {
    // Reset all state
    setAuthRestoreAttempted(false);
    setRestoreAttemptCount(0);
    setSessionCheckFailed(false);
    setNoPageDetected(false);
    setStatus('processing');
    setError(null);
    setProcessing(true);
  };

  // Function to create a Facebook page
  const goToCreateFacebookPage = () => {
    window.open('https://www.facebook.com/pages/create/', '_blank');
  };

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col justify-center py-12 sm:px-6 lg:px-8">
      <div className="sm:mx-auto sm:w-full sm:max-w-md">
        <div className="flex justify-center">
          <MessageSquare className="h-12 w-12 text-indigo-600" />
        </div>
        <h2 className="mt-6 text-center text-3xl font-extrabold text-gray-900">
          Connecting Facebook
        </h2>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
        <div className="bg-white py-8 px-4 shadow sm:rounded-lg sm:px-10 text-center">
          {status === 'processing' || status === 'auth_restore' || status === 'exchanging_code' || status === 'getting_pages' || status === 'saving' ? (
            <>
              <div className="flex justify-center mb-4">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600"></div>
              </div>
              <p className="text-gray-700">
                {status === 'processing' && 'Processing your Facebook connection...'}
                {status === 'auth_restore' && 'Restoring your authentication session...'}
                {status === 'exchanging_code' && 'Exchanging authorization code for access token...'}
                {status === 'getting_pages' && 'Retrieving your Facebook pages...'}
                {status === 'saving' && 'Saving your Facebook page connection...'}
              </p>
              <p className="text-sm text-gray-500 mt-2">
                {sessionCheckFailed ? 'This might take a bit longer than usual. Please be patient.' : 'This might take a moment.'}
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
                {noPageDetected ? (
                  <>
                    <button
                      onClick={goToCreateFacebookPage}
                      className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
                    >
                      <Facebook className="h-4 w-4 mr-2" />
                      Create Facebook Page
                    </button>
                    
                    <button
                      onClick={() => navigate('/settings')}
                      className="inline-flex items-center px-4 py-2 border border-gray-300 text-sm font-medium rounded-md shadow-sm text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
                    >
                      Go Back to Settings
                    </button>
                  </>
                ) : (
                  <>
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
                  </>
                )}
              </div>
            </>
          ) : (
            <>
              <div className="flex justify-center mb-4">
                <Facebook className="h-12 w-12 text-blue-600" />
              </div>
              <div className="bg-green-50 border border-green-200 text-green-600 px-4 py-3 mb-4 rounded-md text-sm">
                Successfully connected to Facebook!
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