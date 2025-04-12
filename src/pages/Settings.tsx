import React, { useState, useEffect } from 'react';
import { Facebook, Instagram, Bot, Trash2, Book, AlertTriangle, Globe, User, Lock, ShieldCheck } from 'lucide-react';
import { supabase, refreshSupabaseToken } from '../lib/supabase';
import { getSocialConnections, getWebhookConfigsByUserId } from '../lib/api';
import { logout } from '../lib/auth';
import { checkFacebookLoginStatus, loginWithFacebook, is2FAError } from '../lib/facebookAuth';
import { waitForFacebookSDK, isFacebookSDKReady } from '../lib/facebookSdk';
import type { SocialConnection, WebhookConfig } from '../types';
import LoadingIndicator from '../components/LoadingIndicator';
import ErrorAlert from '../components/ErrorAlert';
import FacebookLoginButton from '../components/FacebookLoginButton';

export default function Settings() {
  const [socialConnections, setSocialConnections] = useState<SocialConnection[]>([]);
  const [webhookConfigs, setWebhookConfigs] = useState<WebhookConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('account');
  const [error, setError] = useState<string | null>(null);
  const [authRetryCount, setAuthRetryCount] = useState(0);
  const [fbConnecting, setFbConnecting] = useState(false);
  const [userEmail, setUserEmail] = useState<string>('');
  const [userSince, setUserSince] = useState<string>('');
  const [fbDebugInfo, setFbDebugInfo] = useState<string[]>([]);

  useEffect(() => {
    async function loadData() {
      try {
        setLoading(true);
        setError(null);
        
        // Refresh token first to ensure we have a valid session
        try {
          await refreshSupabaseToken();
        } catch (refreshError) {
          console.warn('Token refresh failed:', refreshError);
        }
        
        // Get the current user
        const { data: userData, error: userError } = await supabase.auth.getUser();
        
        if (userError) {
          console.error('Error getting user:', userError);
          throw new Error(`Authentication error: ${userError.message}`);
        }
        
        if (!userData.user) {
          // If we're out of retries, show the error
          if (authRetryCount >= 2) {
            throw new Error('User not authenticated after multiple attempts');
          }
          
          // Try one more refresh and then reload
          console.log(`Authentication retry attempt ${authRetryCount + 1}...`);
          setAuthRetryCount(prev => prev + 1);
          
          // Force token refresh and reload page
          try {
            console.log('Forcing token refresh before retry...');
            await refreshSupabaseToken();
            
            // Wait a moment before retry
            await new Promise(resolve => setTimeout(resolve, 1000));
            
            // Reload the data without page refresh
            loadData();
            return;
          } catch (retryError) {
            console.error('Retry refresh failed:', retryError);
            throw new Error('User not authenticated');
          }
        }

        setUserEmail(userData.user.email || '');
        setUserSince(new Date(userData.user.created_at || Date.now()).toLocaleDateString());
        
        // Load social connections
        try {
          const connections = await getSocialConnections();
          setSocialConnections(connections);
        } catch (connError) {
          console.error('Error loading social connections:', connError);
          // Continue loading other data
        }
        
        // Load webhook configs
        try {
          const webhooks = await getWebhookConfigsByUserId(userData.user.id);
          setWebhookConfigs(webhooks);
        } catch (webhookError) {
          console.error('Error loading webhook configs:', webhookError);
          // Continue loading other data
        }
      } catch (error) {
        console.error('Error loading data:', error);
        setError(error instanceof Error ? error.message : 'Failed to load settings data');
      } finally {
        setLoading(false);
      }
    }

    loadData();
  }, [authRetryCount]);

  const getFacebookConnection = () => {
    return socialConnections.find(conn => conn.fb_page_id);
  };
  
  const getInstagramConnection = () => {
    return socialConnections.find(conn => conn.ig_account_id);
  };
  
  const addFbDebugInfo = (message: string) => {
    console.log(`Facebook Connect: ${message}`);
    setFbDebugInfo(prev => [...prev.slice(-9), message]);
  };

  const handleFacebookConnect = async () => {
    setFbConnecting(true);
    setError(null);
    
    try {
      addFbDebugInfo("Starting Facebook connection process");
      
      // Check if FB SDK is properly loaded
      const isSdkReady = isFacebookSDKReady();
      addFbDebugInfo(`Facebook SDK status: ${isSdkReady ? 'Ready' : 'Not Ready'}`);
      
      if (!isSdkReady) {
        // Wait for the SDK to initialize
        addFbDebugInfo("Waiting for Facebook SDK to initialize...");
        
        try {
          await waitForFacebookSDK(8000); // Increased timeout to 8 seconds
          addFbDebugInfo("Facebook SDK initialized successfully");
        } catch (sdkError) {
          addFbDebugInfo(`SDK initialization failed: ${sdkError instanceof Error ? sdkError.message : 'Unknown error'}`);
          // Fall back to direct OAuth flow
          handleDirectOAuthFlow();
          return;
        }
      }
      
      // Check login status now that we know SDK is ready
      addFbDebugInfo("Checking Facebook login status");
      const statusResponse = await checkFacebookLoginStatus();
      
      addFbDebugInfo(`Facebook status: ${statusResponse.status}`);
      
      // Check for 2FA error specifically
      if (statusResponse.error && is2FAError(statusResponse)) {
        addFbDebugInfo("Detected 2FA challenge, using direct OAuth flow with auth_type=rerequest");
        handleDirectOAuthFlow(true); // Pass true to indicate 2FA scenario
        return;
      }
      
      if (statusResponse.status === 'connected' && statusResponse.authResponse) {
        // User is already logged into Facebook and authorized the app
        addFbDebugInfo("User already connected to Facebook, proceeding to page selection");
        // The handleFacebookStatusChange function will handle the redirect
        await loginWithFacebook();
      } else if (statusResponse.status === 'error') {
        // SDK error occurred, fall back to direct OAuth
        addFbDebugInfo("Facebook SDK error, falling back to direct OAuth");
        handleDirectOAuthFlow();
      } else {
        // User needs to log in or authorize the app
        addFbDebugInfo(`Initiating login flow (status: ${statusResponse.status})`);
        
        const loginResponse = await loginWithFacebook();
        
        // Check for 2FA error in login response
        if (loginResponse.error && is2FAError(loginResponse)) {
          addFbDebugInfo("Detected 2FA challenge during login, using direct OAuth flow with auth_type=rerequest");
          handleDirectOAuthFlow(true); // Pass true to indicate 2FA scenario
          return;
        }
        
        if (loginResponse.status === 'connected') {
          addFbDebugInfo("Facebook login successful, redirect should happen automatically");
        } else if (loginResponse.status === 'error') {
          addFbDebugInfo("Error during Facebook login, falling back to direct OAuth");
          handleDirectOAuthFlow();
        } else {
          addFbDebugInfo(`Facebook login was not successful: ${loginResponse.status}`);
          throw new Error(`Facebook login failed: ${loginResponse.status}`);
        }
      }
    } catch (err) {
      console.error('Error connecting to Facebook:', err);
      addFbDebugInfo(`Error: ${err instanceof Error ? err.message : 'Unknown error'}`);
      setError(err instanceof Error ? err.message : 'Failed to connect to Facebook');
      
      // Fall back to direct OAuth as a last resort
      handleDirectOAuthFlow();
    } finally {
      setFbConnecting(false);
    }
  };

  // Helper function for direct OAuth flow
  const handleDirectOAuthFlow = async (is2FAFlow = false) => {
    addFbDebugInfo(`Using direct OAuth flow${is2FAFlow ? ' (2FA mode)' : ''}`);
    
    // Save the current auth session in localStorage before redirecting
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (session) {
        // Store a minimal version of the session to maintain auth state
        localStorage.setItem('fb_auth_state', JSON.stringify({
          userId: session.user.id,
          expiresAt: session.expires_at,
          timestamp: Date.now()
        }));
        addFbDebugInfo("Saved authentication state to localStorage");
      }
    } catch (sessionError) {
      addFbDebugInfo(`Error saving auth state: ${sessionError instanceof Error ? sessionError.message : 'Unknown error'}`);
    }
    
    // IMPORTANT: Use the fixed redirect URL that matches your Meta app configuration
    const redirectUri = `https://crt-tech.org/oauth/facebook/callback`;
    const appId = window.ENV?.META_APP_ID;
    
    if (!appId) {
      throw new Error('Facebook App ID is missing in environment variables');
    }
    
    // For 2FA flow, add auth_type=rerequest to trigger Facebook's 2FA handling
    const authTypeParam = is2FAFlow ? '&auth_type=rerequest' : '';
    
    addFbDebugInfo(`Redirecting to Facebook OAuth URL with fixed redirect: ${redirectUri}`);
    window.location.href = `https://www.facebook.com/v18.0/dialog/oauth?client_id=${appId}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=public_profile,email,pages_show_list,pages_messaging&response_type=code${authTypeParam}`;
  };

  const handleInstagramConnect = () => {
    // Save the current auth session in localStorage before redirecting
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) {
        // Store a minimal version of the session to maintain auth state
        localStorage.setItem('fb_auth_state', JSON.stringify({
          userId: session.user.id,
          expiresAt: session.expires_at,
          timestamp: Date.now()
        }));
      }
      
      const redirectUri = `https://crt-tech.org/oauth/instagram/callback`;
      window.location.href = `https://www.facebook.com/v18.0/dialog/oauth?client_id=${window.ENV?.META_APP_ID}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=public_profile,email,pages_show_list,pages_messaging,instagram_basic,instagram_manage_messages&response_type=code`;
    }).catch(error => {
      console.error('Error getting session:', error);
      setError('Failed to prepare for Instagram connection');
    });
  };
  
  const handleDisconnectSocial = async (connectionId: string) => {
    if (!connectionId) {
      setError("No connection ID provided");
      return;
    }
    
    if (!confirm('Are you sure you want to disconnect this account?')) return;
    
    try {
      const { error } = await supabase
        .from('social_connections')
        .delete()
        .eq('id', connectionId);
        
      if (error) throw error;
      
      // Update the list by removing the deleted connection
      setSocialConnections(prevConnections => 
        prevConnections.filter(conn => conn.id !== connectionId)
      );
      
      alert('Successfully disconnected account');
    } catch (error) {
      console.error('Error disconnecting account:', error);
      setError(error instanceof Error ? error.message : 'Failed to disconnect account');
    }
  };

  const handleDataDeletion = () => {
    if (window.confirm('Are you sure you want to request deletion of all your data? This action cannot be undone.')) {
      // In a real implementation, you would call your API to initiate the data deletion process
      window.location.href = '/deletion-status?code=MANUAL' + Math.random().toString(36).substring(2, 10).toUpperCase();
    }
  };

  const handleSignOut = async () => {
    try {
      await logout();
      window.location.href = '/auth';
    } catch (error) {
      console.error('Error signing out:', error);
      setError('Failed to sign out');
    }
  };

  const handleRetryAuthentication = async () => {
    setLoading(true);
    setError(null);
    
    try {
      // Clear any existing auth state
      await supabase.auth.signOut();
      
      // Clear all localStorage
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && (key.includes('supabase') || key.includes('sb-'))) {
          localStorage.removeItem(key);
        }
      }
      
      // Redirect to auth page
      window.location.href = '/auth';
    } catch (error) {
      console.error('Error during authentication retry:', error);
      setError('Failed to reset authentication. Please try reloading the page.');
      setLoading(false);
    }
  };

  if (loading) {
    return <LoadingIndicator message="Loading settings..." />;
  }

  if (error && error.includes('User not authenticated')) {
    return (
      <div className="bg-white shadow rounded-lg p-8 max-w-lg mx-auto mt-8">
        <div className="text-center">
          <AlertTriangle className="h-12 w-12 text-yellow-500 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-900 mb-2">Authentication Error</h3>
          <p className="text-gray-600 mb-6">
            Your session appears to be invalid or has expired. Please try authenticating again.
          </p>
          <button
            onClick={handleRetryAuthentication}
            className="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
          >
            Sign In Again
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="border-b border-gray-200">
        <nav className="-mb-px flex space-x-8">
          <button
            onClick={() => setActiveTab('account')}
            className={`${
              activeTab === 'account'
                ? 'border-indigo-500 text-indigo-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            } whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm`}
          >
            Account Settings
          </button>
          <button
            onClick={() => setActiveTab('connections')}
            className={`${
              activeTab === 'connections'
                ? 'border-indigo-500 text-indigo-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            } whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm`}
          >
            Social Connections
          </button>
          <button
            onClick={() => setActiveTab('privacy')}
            className={`${
              activeTab === 'privacy'
                ? 'border-indigo-500 text-indigo-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            } whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm`}
          >
            Privacy & Data
          </button>
        </nav>
      </div>

      {error && (
        <ErrorAlert 
          message="Error" 
          details={error} 
          onDismiss={() => setError(null)} 
        />
      )}
      
      {activeTab === 'account' && (
        <div className="bg-white shadow rounded-lg">
          <div className="px-4 py-5 sm:p-6">
            <h3 className="text-lg leading-6 font-medium text-gray-900 mb-4">Account Information</h3>
            
            <div className="space-y-6">
              <div className="flex items-center">
                <div className="bg-indigo-100 rounded-full p-3 mr-4">
                  <User className="h-6 w-6 text-indigo-600" />
                </div>
                <div>
                  <p className="text-sm font-medium text-gray-500">Email Address</p>
                  <p className="mt-1 text-lg text-gray-900">{userEmail}</p>
                </div>
              </div>
              
              <div className="flex items-center">
                <div className="bg-green-100 rounded-full p-3 mr-4">
                  <ShieldCheck className="h-6 w-6 text-green-600" />
                </div>
                <div>
                  <p className="text-sm font-medium text-gray-500">Account Type</p>
                  <p className="mt-1 text-lg text-gray-900">Customer</p>
                </div>
              </div>
              
              <div className="flex items-center">
                <div className="bg-blue-100 rounded-full p-3 mr-4">
                  <Globe className="h-6 w-6 text-blue-600" />
                </div>
                <div>
                  <p className="text-sm font-medium text-gray-500">Member Since</p>
                  <p className="mt-1 text-lg text-gray-900">{userSince}</p>
                </div>
              </div>
              
              <div className="pt-5 border-t border-gray-200">
                <button
                  onClick={handleSignOut}
                  className="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-red-600 hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500"
                >
                  Sign Out
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      
      {activeTab === 'connections' && (
        <div className="bg-white shadow rounded-lg">
          <div className="px-4 py-5 sm:p-6">
            <h3 className="text-lg leading-6 font-medium text-gray-900">Social Media Connections</h3>
            <p className="mt-1 text-sm text-gray-500">
              Connect your social media accounts to use with the AI assistant
            </p>
            
            <div className="mt-5 space-y-4">
              <div className="border rounded-md overflow-hidden">
                <div className="bg-gray-50 px-4 py-3 border-b">
                  <h4 className="text-sm font-medium text-gray-700">Facebook Pages</h4>
                </div>
                
                {getFacebookConnection() ? (
                  <div className="p-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center">
                        <Facebook className="h-5 w-5 text-blue-600 mr-2" />
                        <span className="text-sm text-gray-900">
                          Connected to Page ID: {getFacebookConnection()?.fb_page_id}
                        </span>
                      </div>
                      <button
                        onClick={() => handleDisconnectSocial(getFacebookConnection()?.id || '')}
                        className="text-red-600 hover:text-red-800"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                    <p className="mt-2 text-xs text-gray-500">
                      Your Facebook page is connected. Access token management is handled by your administrator.
                    </p>
                  </div>
                ) : (
                  <div className="p-4">
                    <div className="mb-4">
                      <FacebookLoginButton 
                        onLoginSuccess={() => console.log('Facebook login successful')} 
                        onLoginFailure={(err) => {
                          setError(err);
                          addFbDebugInfo(`Login failure: ${err}`);
                        }}
                        scope="public_profile,email,pages_show_list,pages_messaging"
                      />
                    </div>
                    
                    <div className="text-center mt-3">
                      <span className="inline-block border-t border-gray-300 w-full relative">
                        <span className="px-2 bg-white relative -top-3 text-xs text-gray-500">or</span>
                      </span>
                    </div>
                    
                    <div className="mt-3 text-center">
                      <button
                        onClick={handleFacebookConnect}
                        disabled={fbConnecting}
                        className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50"
                      >
                        {fbConnecting ? (
                          <>
                            <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                            Connecting...
                          </>
                        ) : (
                          <>
                            <Facebook className="h-5 w-5 mr-2" />
                            Connect Manually
                          </>
                        )}
                      </button>
                    </div>
                    
                    {fbDebugInfo.length > 0 && (
                      <div className="mt-4 p-3 bg-gray-50 rounded-md">
                        <p className="text-xs text-gray-700 font-medium">Connection Status:</p>
                        <div className="text-xs text-gray-600 mt-1 space-y-1">
                          {fbDebugInfo.map((info, idx) => (
                            <div key={idx} className="bg-white p-1 rounded">{info}</div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
              
              <div className="border rounded-md overflow-hidden">
                <div className="bg-gray-50 px-4 py-3 border-b">
                  <h4 className="text-sm font-medium text-gray-700">Instagram Business Account</h4>
                </div>
                
                {getInstagramConnection() ? (
                  <div className="p-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center">
                        <Instagram className="h-5 w-5 text-pink-600 mr-2" />
                        <span className="text-sm text-gray-900">
                          Connected to Account ID: {getInstagramConnection()?.ig_account_id}
                        </span>
                      </div>
                      <button
                        onClick={() => handleDisconnectSocial(getInstagramConnection()?.id || '')}
                        className="text-red-600 hover:text-red-800"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                    <p className="mt-2 text-xs text-gray-500">
                      Your Instagram account is connected. Access token management is handled by your administrator.
                    </p>
                  </div>
                ) : (
                  <div className="p-4">
                    <button
                      onClick={handleInstagramConnect}
                      className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-pink-600 hover:bg-pink-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-pink-500"
                    >
                      <Instagram className="h-5 w-5 mr-2" />
                      Connect Instagram Account
                    </button>
                  </div>
                )}
              </div>
              
              {(!getFacebookConnection() && !getInstagramConnection()) && (
                <div className="bg-yellow-50 border-l-4 border-yellow-400 p-4 mt-4">
                  <div className="flex">
                    <div className="flex-shrink-0">
                      <AlertTriangle className="h-5 w-5 text-yellow-400" />
                    </div>
                    <div className="ml-3">
                      <p className="text-sm text-yellow-700">
                        Connect at least one social account to enable the AI assistant to respond to your messages.
                      </p>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {activeTab === 'privacy' && (
        <div className="space-y-6">
          <div className="bg-white shadow rounded-lg">
            <div className="px-4 py-5 sm:p-6">
              <h3 className="text-lg leading-6 font-medium text-gray-900">Privacy and Data Management</h3>
              <p className="mt-2 text-sm text-gray-500">
                Manage your data and privacy settings. You can request deletion of your data at any time.
              </p>

              <div className="mt-6 border-t border-gray-200 pt-6">
                <h4 className="text-md font-medium text-gray-900">Data Deletion</h4>
                <p className="mt-2 text-sm text-gray-500">
                  You can request the deletion of all your data from our system. This action cannot be undone.
                </p>
                <div className="mt-4">
                  <button
                    onClick={handleDataDeletion}
                    className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-red-600 hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500"
                  >
                    <Trash2 className="h-4 w-4 mr-2" />
                    Delete My Data
                  </button>
                </div>
              </div>

              <div className="mt-6 border-t border-gray-200 pt-6">
                <h4 className="text-md font-medium text-gray-900">Facebook Data Deletion</h4>
                <p className="mt-2 text-sm text-gray-500">
                  When you remove our app from your Facebook settings or remove access to your data in your Facebook account Settings, 
                  we automatically receive a data deletion request and will remove your Facebook-related data.
                </p>
                <p className="mt-2 text-sm text-gray-500">
                  You can also visit your Facebook settings directly to manage app permissions:
                </p>
                <div className="mt-4">
                  <a
                    href="https://www.facebook.com/settings?tab=applications"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center px-4 py-2 border border-gray-300 shadow-sm text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
                  >
                    <Facebook className="h-4 w-4 mr-2 text-blue-600" />
                    Manage Facebook Permissions
                  </a>
                </div>
              </div>

              <div className="mt-6 border-t border-gray-200 pt-6">
                <h4 className="text-md font-medium text-gray-900">Privacy Policy</h4>
                <p className="mt-2 text-sm text-gray-500">
                  Our privacy policy explains how we collect, use, and protect your data.
                </p>
                <div className="mt-4">
                  <a
                    href="/privacy-policy"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-indigo-600 hover:text-indigo-500"
                  >
                    View Privacy Policy
                  </a>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}