import React, { useEffect, useRef, useState } from 'react';
import { handleFacebookStatusChange, is2FAError } from '../lib/facebookAuth';
import { waitForFacebookSDK, parseXFBML, isFacebookSDKReady, loginWithFacebook } from '../lib/facebookSdk';
import { AlertTriangle } from 'lucide-react';
import { supabase } from '../lib/supabase';

interface FacebookLoginButtonProps {
  onLoginSuccess?: () => void;
  onLoginFailure?: (error: string) => void;
  scope?: string;
  autoLogoutLink?: boolean;
  width?: string;
}

declare global {
  interface Window {
    checkLoginState: () => void;
    FB: any;
    fbAsyncInit: any;
  }
}

const FacebookLoginButton: React.FC<FacebookLoginButtonProps> = ({
  onLoginSuccess,
  onLoginFailure,
  scope = "public_profile,email,pages_show_list,pages_messaging",
  autoLogoutLink = false,
  width = "300px"
}) => {
  const buttonRef = useRef<HTMLDivElement>(null);
  const buttonId = `fb-button-${Math.random().toString(36).substring(2, 10)}`;
  const [sdkLoaded, setSdkLoaded] = useState(false);
  const [sdkError, setSdkError] = useState('');
  const [buttonRendered, setButtonRendered] = useState(false);
  const [sdkCheckAttempts, setSdkCheckAttempts] = useState(0);
  const [is2FADetected, setIs2FADetected] = useState(false);

  // Define the global callback function that the FB button will call
  useEffect(() => {
    window.checkLoginState = async function() {
      try {
        // Only proceed if SDK is ready
        if (isFacebookSDKReady()) {
          window.FB.getLoginStatus(function(response: any) {
            statusChangeCallback(response);
          });
        } else {
          console.log("Facebook SDK not fully initialized, waiting...");
          // Wait for SDK to initialize before checking login status
          waitForFacebookSDK(5000)
            .then(() => {
              window.FB.getLoginStatus(function(response: any) {
                statusChangeCallback(response);
              });
            })
            .catch(error => {
              console.error("Facebook SDK initialization timed out:", error);
              setSdkError("Facebook SDK failed to initialize. Please refresh the page and try again.");
              if (onLoginFailure) onLoginFailure("Facebook SDK not initialized");
            });
        }
      } catch (error) {
        console.error("Error in checkLoginState:", error);
        setSdkError("Error checking login status. Please try again.");
        if (onLoginFailure) onLoginFailure("Error checking login status");
      }
    };

    // Process the login status
    const statusChangeCallback = async (response: any) => {
      console.log('Facebook login status response:', response);
      
      // Check for 2FA error
      if (response.error && is2FAError(response)) {
        console.log('Detected 2FA challenge in the response');
        setIs2FADetected(true);
        if (onLoginFailure) {
          onLoginFailure('Facebook requires two-factor authentication. Please complete the 2FA process and try again.');
        }
        return;
      }
      
      try {
        const success = await handleFacebookStatusChange(response);
        if (success && onLoginSuccess) {
          onLoginSuccess();
        } else if (!success && onLoginFailure) {
          onLoginFailure('Login was not successful');
        }
      } catch (error) {
        console.error('Error handling Facebook status change:', error);
        setSdkError(error instanceof Error ? error.message : 'Unknown error occurred');
        if (onLoginFailure) {
          onLoginFailure(error instanceof Error ? error.message : 'Unknown error occurred');
        }
      }
    };

    return () => {
      // Keep the global checkLoginState function as other buttons might need it
    };
  }, [scope, onLoginSuccess, onLoginFailure]);

  // Initialize and ensure Facebook SDK is ready
  useEffect(() => {
    let checkTimeoutId: NodeJS.Timeout;
    let maxCheckTime = false;
    
    const initializeButton = async () => {
      try {
        // Wait for SDK to be ready
        await waitForFacebookSDK(8000);
        setSdkLoaded(true);
        
        // Make sure button ref is available
        if (!buttonRef.current) {
          console.warn("Button ref not available yet");
          return;
        }
        
        // Remove any existing buttons to prevent duplication
        const existingButtons = buttonRef.current.querySelectorAll('.fb-login-button');
        existingButtons.forEach(button => {
          if (button.id !== buttonId) {
            button.remove();
          }
        });
        
        // Parse XFBML in the button container
        await parseXFBML(buttonRef.current);
        setButtonRendered(true);
        setSdkError('');
        console.log("Facebook button rendered successfully");
      } catch (error) {
        console.error("Error initializing Facebook button:", error);
        setSdkError("Failed to initialize Facebook login. Please refresh the page or try another method.");
      }
    };
    
    // Check periodically if the SDK is loaded and render button when ready
    const checkAndRenderButton = () => {
      if (isFacebookSDKReady() && buttonRef.current) {
        setSdkLoaded(true);
        parseXFBML(buttonRef.current)
          .then(() => {
            setButtonRendered(true);
            setSdkError('');
          })
          .catch(error => {
            console.error("Error parsing XFBML:", error);
            setSdkError("Failed to render Facebook button. Please try again.");
          });
        return true;
      }
      return false;
    };
    
    // Initial attempt
    if (!checkAndRenderButton()) {
      // Set up periodic checks
      const checkInterval = setInterval(() => {
        if (maxCheckTime || checkAndRenderButton()) {
          clearInterval(checkInterval);
        } else {
          setSdkCheckAttempts(prev => prev + 1);
        }
      }, 1000);
      
      // Set a maximum time to wait
      checkTimeoutId = setTimeout(() => {
        clearInterval(checkInterval);
        maxCheckTime = true;
        if (!sdkLoaded) {
          setSdkError("Facebook SDK took too long to load. Please refresh the page or try direct login.");
        }
      }, 15000);
    }
    
    return () => {
      clearTimeout(checkTimeoutId);
    };
  }, [buttonId]);

  // Force manual initialization if FB SDK is available but not loaded properly
  const handleManualInitialization = () => {
    setSdkError('');
    
    if (typeof window.FB !== 'undefined' && buttonRef.current) {
      try {
        window.FB.XFBML.parse(buttonRef.current);
        setSdkLoaded(true);
        setButtonRendered(true);
      } catch (e) {
        console.error("Error in manual initialization:", e);
        setSdkError("Failed to initialize Facebook button manually. Please try direct login.");
      }
    } else {
      // If the SDK is not available, try to reload the script
      const fbScript = document.getElementById('facebook-jssdk');
      if (fbScript) {
        fbScript.remove();
      }
      
      // Create and append a new script element
      const script = document.createElement('script');
      script.id = 'facebook-jssdk';
      script.src = "https://connect.facebook.net/en_US/sdk.js";
      script.async = true;
      script.defer = true;
      script.crossOrigin = "anonymous";
      document.head.appendChild(script);
      
      script.onload = () => {
        console.log("Facebook SDK manually reloaded");
        
        // Initialize the SDK
        if (typeof window.FB !== 'undefined') {
          // Get app ID from environment
          const appId = window.ENV?.META_APP_ID || import.meta.env.VITE_META_APP_ID;
          
          if (!appId) {
            setSdkError('Facebook App ID missing. Check configuration.');
            return;
          }
          
          window.FB.init({
            appId: appId,
            cookie: true,
            xfbml: true,
            version: 'v18.0'
          });
          
          if (buttonRef.current) {
            window.FB.XFBML.parse(buttonRef.current);
            setSdkError('');
            setSdkLoaded(true);
            setButtonRendered(true);
          }
        }
      };
      
      script.onerror = () => {
        setSdkError('Failed to load Facebook SDK. Please try direct login.');
      };
    }
  };

  // Fallback to direct URL if button doesn't load
  const handleDirectLogin = () => {
    const appId = window.ENV?.META_APP_ID || import.meta.env.VITE_META_APP_ID;
    if (!appId) {
      setSdkError('Facebook App ID is missing. Please check your configuration.');
      return;
    }
    
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
      
      const redirectUri = encodeURIComponent(`https://crt-tech.org/oauth/facebook/callback`);
      const loginUrl = `https://www.facebook.com/v18.0/dialog/oauth?client_id=${appId}&redirect_uri=${redirectUri}&scope=${encodeURIComponent(scope)}&response_type=code`;
      
      console.log('Redirecting to Facebook login URL:', loginUrl);
      window.location.href = loginUrl;
    }).catch(error => {
      console.error('Error getting session:', error);
      setSdkError(`Failed to prepare for Facebook login: ${error.message}`);
    });
  };

  // Handle login with SDK directly
  const handleSdkLogin = async () => {
    try {
      const response = await loginWithFacebook(scope);
      
      // Check for 2FA error
      if (response.error && is2FAError(response)) {
        console.log('Detected 2FA challenge during SDK login');
        setIs2FADetected(true);
        if (onLoginFailure) {
          onLoginFailure('Facebook requires two-factor authentication. Please complete the 2FA process and try again.');
        }
        return;
      }
      
      if (response.status === 'connected') {
        console.log("Login successful through SDK");
        const success = await handleFacebookStatusChange(response);
        if (success && onLoginSuccess) {
          onLoginSuccess();
        }
      } else {
        console.log("Login unsuccessful:", response);
        if (onLoginFailure) onLoginFailure('Login was not successful');
      }
    } catch (error) {
      console.error("SDK login error:", error);
      setSdkError("Error during Facebook login. Please try direct login instead.");
    }
  };

  // Helper to handle 2FA scenarios
  const handle2FAScenario = () => {
    setIs2FADetected(false);
    
    // Save the current auth session in localStorage before redirecting
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) {
        // Store a minimal version of the session to maintain auth state with extended timestamp
        // for longer validity during 2FA process
        localStorage.setItem('fb_auth_state', JSON.stringify({
          userId: session.user.id,
          expiresAt: session.expires_at,
          timestamp: Date.now()
        }));
      }
      
      // Direct OAuth flow for 2FA scenarios - this should trigger Facebook's native 2FA flow
      const appId = window.ENV?.META_APP_ID || import.meta.env.VITE_META_APP_ID;
      if (!appId) {
        setSdkError('Facebook App ID is missing. Please check your configuration.');
        return;
      }
      
      const redirectUri = encodeURIComponent(`https://crt-tech.org/oauth/facebook/callback`);
      const loginUrl = `https://www.facebook.com/v18.0/dialog/oauth?client_id=${appId}&redirect_uri=${redirectUri}&scope=${encodeURIComponent(scope)}&response_type=code&auth_type=rerequest`;
      
      console.log('Redirecting to Facebook login URL with rerequest auth type for 2FA handling:', loginUrl);
      window.location.href = loginUrl;
    }).catch(error => {
      console.error('Error getting session:', error);
      setSdkError(`Failed to prepare for Facebook login: ${error.message}`);
    });
  };

  return (
    <div className="space-y-3">
      {is2FADetected ? (
        <div className="bg-yellow-50 border border-yellow-200 rounded p-4">
          <div className="flex items-start">
            <AlertTriangle className="h-5 w-5 text-yellow-400 mr-2 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-yellow-800">Two-Factor Authentication Required</p>
              <p className="text-sm text-yellow-700 mt-1">
                Facebook requires you to complete two-factor authentication. Please click the button below to continue.
              </p>
              <button
                onClick={handle2FAScenario}
                className="mt-3 inline-flex items-center px-3 py-2 border border-transparent text-sm leading-4 font-medium rounded-md text-white bg-yellow-600 hover:bg-yellow-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-yellow-500"
              >
                Continue with 2FA
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div className="facebook-login-container" ref={buttonRef}>
          {!buttonRendered && (
            <div className="fb-button-placeholder"></div>
          )}
          <div 
            id={buttonId}
            className="fb-login-button" 
            data-width={width}
            data-size="large"
            data-button-type="continue_with"
            data-layout="rounded"
            data-auto-logout-link={autoLogoutLink ? "true" : "false"}
            data-use-continue-as="false"
            data-scope={scope}
            data-onlogin="checkLoginState();"
          ></div>
        </div>
      )}
      
      {sdkError && !is2FADetected && (
        <div className="bg-red-50 border border-red-200 rounded p-3">
          <div className="flex items-start">
            <AlertTriangle className="h-5 w-5 text-red-400 mr-2 mt-0.5" />
            <div>
              <p className="text-sm text-red-700">{sdkError}</p>
              <div className="mt-2 flex flex-col sm:flex-row gap-2">
                <button 
                  onClick={handleManualInitialization}
                  className="text-xs px-2 py-1 bg-red-100 text-red-700 rounded hover:bg-red-200"
                >
                  Retry Loading
                </button>
                <button 
                  onClick={handleSdkLogin}
                  className="text-xs px-2 py-1 bg-blue-100 text-blue-700 rounded hover:bg-blue-200"
                >
                  Try SDK Login
                </button>
                <button 
                  onClick={handleDirectLogin}
                  className="text-xs px-2 py-1 bg-green-100 text-green-700 rounded hover:bg-green-200"
                >
                  Direct Login
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default FacebookLoginButton;