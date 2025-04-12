import { supabase } from './supabase';
import { waitForFacebookSDK, isFacebookSDKReady } from './facebookSdk';
import type { User, AuthStatus } from '../types';

// Type definitions for Facebook responses
export interface FacebookAuthResponse {
  accessToken: string;
  expiresIn: number;
  signedRequest: string;
  userID: string;
}

export interface FacebookStatusResponse {
  status: 'connected' | 'not_authorized' | 'unknown' | 'error';
  authResponse: FacebookAuthResponse | null;
  error?: {
    message?: string;
    type?: string;
    code?: number;
    errorSummary?: string;
    errorSubcode?: number;
  };
}

export interface FacebookPage {
  id: string;
  name: string;
  access_token: string;
  category: string;
  tasks?: string[];
}

// Special error codes for Facebook 2FA
export const FB_2FA_ERROR_CODE = 1357004;
export const FB_2FA_ERROR_SUBCODE = 1357045;

/**
 * Check if the error response is a 2FA error
 */
export function is2FAError(response: any): boolean {
  return (
    response?.error?.code === FB_2FA_ERROR_CODE ||
    response?.error?.errorSubcode === FB_2FA_ERROR_SUBCODE ||
    (response?.error?.errorSummary && response?.error?.errorSummary.includes('2-factor')) ||
    (response?.error?.message && response?.error?.message.includes('two-factor')) ||
    (response?.error?.message && response?.error?.message.includes('2FA'))
  );
}

// Function to check Facebook login status
export async function checkFacebookLoginStatus(): Promise<FacebookStatusResponse> {
  try {
    // Ensure SDK is loaded and ready
    await waitForFacebookSDK(10000);
    
    return new Promise((resolve) => {
      window.FB.getLoginStatus((response: FacebookStatusResponse) => {
        console.log('Facebook login status:', response);
        resolve(response);
      });
    });
  } catch (error) {
    console.error('Error checking Facebook login status:', error);
    return { status: 'error', authResponse: null };
  }
}

// The callback function that will be called from checkLoginState
export async function statusChangeCallback(response: FacebookStatusResponse): Promise<boolean> {
  return handleFacebookStatusChange(response);
}

// Function to determine the base URL for Netlify functions
export function getNetlifyFunctionsBaseUrl() {
  // In development or when no domain is set, use relative path
  if (window.location.hostname === 'localhost' || 
      window.location.hostname.includes('stackblitz') || 
      window.location.hostname.includes('127.0.0.1')) {
    return '/.netlify/functions';
  }
  
  // In production with known domain, use the full URL
  return 'https://crt-tech.org/.netlify/functions';
}

// Handle status change
export function handleFacebookStatusChange(response: FacebookStatusResponse): Promise<boolean> {
  return new Promise(async (resolve) => {
    if (response.status === 'connected' && response.authResponse) {
      // User is logged in to Facebook and has authorized the app
      console.log('Connected to Facebook, authorized app');
      
      try {
        // Get the Facebook access token and user ID
        const fbToken = response.authResponse.accessToken;
        const userId = response.authResponse.userID;
        
        console.log('Facebook auth response:', {
          token: fbToken ? `${fbToken.substring(0, 10)}...` : 'missing',
          userId,
          expiresIn: response.authResponse.expiresIn
        });
        
        // Get additional user information from Facebook
        try {
          const userInfo = await getFacebookUserInfo(userId, fbToken);
          console.log('Facebook user info:', userInfo);
        } catch (userInfoError) {
          console.warn('Could not get Facebook user info:', userInfoError);
          // Continue anyway
        }
        
        // Get user's Facebook pages
        try {
          const pages = await getFacebookPages(fbToken);
          console.log('Facebook pages:', pages);
          
          if (pages && pages.length > 0) {
            // Store pages in localStorage for the callback to use
            localStorage.setItem('fb_pages', JSON.stringify(pages));
          }
        } catch (pagesError) {
          console.warn('Could not get Facebook pages:', pagesError);
          // Continue anyway
        }
        
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
          }
        } catch (sessionError) {
          console.error('Error saving auth state:', sessionError);
        }
        
        // Redirect to Facebook OAuth dialog with code response type
        // Code response type is required for server-side token exchange
        // IMPORTANT: Use the hardcoded redirect URL that matches your Meta app configuration
        const appId = import.meta.env.VITE_META_APP_ID;
        const redirectUri = `https://crt-tech.org/oauth/facebook/callback`;
        
        if (!appId) {
          console.error('Facebook App ID is not configured');
          resolve(false);
          return;
        }
        
        // Redirect to Facebook OAuth dialog with code response type
        window.location.href = `https://www.facebook.com/v18.0/dialog/oauth?client_id=${appId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=public_profile,email,pages_show_list,pages_messaging`;
        
        resolve(true);
      } catch (error) {
        console.error('Error handling Facebook login:', error);
        resolve(false);
      }
    } else if (response.status === 'not_authorized') {
      // User is logged into Facebook but has not authorized the app
      console.log('Not authorized: User is logged into Facebook but has not authorized the app');
      
      // Check if this appears to be a 2FA challenge
      if (is2FAError(response)) {
        console.log('Detected possible 2FA challenge, showing message to user');
        // In a real implementation, you might show a special message to the user
        // informing them about the 2FA challenge and providing guidance
        
        // Still proceed with the OAuth flow, but let the caller know this is a 2FA situation
        resolve(false);
      }
      
      // Save current auth state
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (session) {
          localStorage.setItem('fb_auth_state', JSON.stringify({
            userId: session.user.id,
            expiresAt: session.expires_at,
            timestamp: Date.now()
          }));
        }
      } catch (error) {
        console.error('Error saving auth state:', error);
      }
      
      // Redirect to Facebook OAuth dialog
      const appId = import.meta.env.VITE_META_APP_ID;
      const redirectUri = `https://crt-tech.org/oauth/facebook/callback`;
      
      if (!appId) {
        console.error('Facebook App ID is not configured');
        resolve(false);
        return;
      }
      
      window.location.href = `https://www.facebook.com/v18.0/dialog/oauth?client_id=${appId}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=public_profile,email,pages_show_list,pages_messaging&response_type=code`;
      
      resolve(false);
    } else {
      // User is not logged into Facebook
      console.log('User is not logged into Facebook, initiating OAuth flow');
      
      // Save current auth state
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (session) {
          localStorage.setItem('fb_auth_state', JSON.stringify({
            userId: session.user.id,
            expiresAt: session.expires_at,
            timestamp: Date.now()
          }));
        }
      } catch (error) {
        console.error('Error saving auth state:', error);
      }
      
      // Redirect to Facebook login
      const appId = import.meta.env.VITE_META_APP_ID;
      const redirectUri = `https://crt-tech.org/oauth/facebook/callback`;
      
      if (!appId) {
        console.error('Facebook App ID is not configured');
        resolve(false);
        return;
      }
      
      window.location.href = `https://www.facebook.com/v18.0/dialog/oauth?client_id=${appId}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=public_profile,email,pages_show_list,pages_messaging&response_type=code`;
      
      resolve(false);
    }
  });
}

// Function to check login state - follows Facebook's documentation pattern
export async function checkLoginState(): Promise<void> {
  try {
    // Ensure SDK is ready
    await waitForFacebookSDK();
    
    window.FB.getLoginStatus(function(response: FacebookStatusResponse) {
      statusChangeCallback(response);
    });
  } catch (error) {
    console.error('Error in checkLoginState:', error);
  }
}

// Function to initiate Facebook login
export async function loginWithFacebook(scope: string = "public_profile,email,pages_show_list,pages_messaging"): Promise<FacebookStatusResponse> {
  try {
    // Ensure SDK is ready
    await waitForFacebookSDK();
    
    return new Promise((resolve) => {
      window.FB.login((response) => {
        console.log("Facebook login response:", response);
        
        // Check for 2FA error
        if (response.error && is2FAError(response)) {
          console.log("Detected 2FA challenge during login");
          response.status = 'error';
          resolve(response as FacebookStatusResponse);
          return;
        }
        
        if (response.status === 'connected') {
          // Successful login, resolve with the response
          resolve(response as FacebookStatusResponse);
        } else {
          // Login was not successful
          console.log("Facebook login was not successful:", response);
          resolve(response as FacebookStatusResponse);
        }
      }, { scope, auth_type: 'rerequest' });
    });
  } catch (error) {
    console.error('Error initiating Facebook login:', error);
    
    // If SDK isn't available, redirect directly to the OAuth flow
    const appId = import.meta.env.VITE_META_APP_ID;
    const redirectUri = `https://crt-tech.org/oauth/facebook/callback`;
    
    if (!appId) {
      throw new Error('Facebook App ID is not configured');
    }
    
    // Save current auth state
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (session) {
        localStorage.setItem('fb_auth_state', JSON.stringify({
          userId: session.user.id,
          expiresAt: session.expires_at,
          timestamp: Date.now()
        }));
      }
    } catch (sessionError) {
      console.error('Error saving auth state:', sessionError);
    }
    
    window.location.href = `https://www.facebook.com/v18.0/dialog/oauth?client_id=${appId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=public_profile,email,pages_show_list,pages_messaging`;
    
    return { status: 'error', authResponse: null };
  }
}

// Get user information from Facebook
export async function getFacebookUserInfo(userId: string, accessToken: string): Promise<any> {
  try {
    // Ensure SDK is ready
    await waitForFacebookSDK();
    
    return new Promise((resolve, reject) => {
      window.FB.api(
        `/${userId}`,
        'GET',
        { fields: 'id,name,email', access_token: accessToken },
        (response: any) => {
          if (!response || response.error) {
            reject(response?.error || new Error('Failed to get user info'));
            return;
          }
          resolve(response);
        }
      );
    });
  } catch (error) {
    console.error('Error getting Facebook user info:', error);
    throw error;
  }
}

// Get Facebook pages
export async function getFacebookPages(accessToken: string): Promise<FacebookPage[]> {
  try {
    // Ensure SDK is ready
    await waitForFacebookSDK();
    
    return new Promise((resolve, reject) => {
      window.FB.api(
        '/me/accounts',
        'GET',
        { access_token: accessToken },
        (response: any) => {
          if (!response || response.error) {
            reject(response?.error || new Error('Failed to get pages'));
            return;
          }
          
          // Transform the response to match our FacebookPage interface
          const pages: FacebookPage[] = response.data.map((page: any) => ({
            id: page.id,
            name: page.name,
            access_token: page.access_token,
            category: page.category,
            tasks: page.tasks || []
          }));
          
          resolve(pages);
        }
      );
    });
  } catch (error) {
    console.error('Error getting Facebook pages:', error);
    throw error;
  }
}

// A helper function to check if the Facebook SDK is ready
export function isFacebookSDKLoaded(): boolean {
  return isFacebookSDKReady();
}

// Helper to restore saved auth state after returning from Facebook
export async function restoreFacebookAuthState(): Promise<boolean> {
  try {
    const savedState = localStorage.getItem('fb_auth_state');
    if (!savedState) {
      console.log('No Facebook auth state found to restore');
      return false;
    }
    
    const parsedState = JSON.parse(savedState);
    const { userId, expiresAt, timestamp } = parsedState;
    
    console.log('Attempting to restore Facebook auth state:', {
      userId: userId ? userId.substring(0, 8) + '...' : 'missing',
      expiresAt: expiresAt ? new Date(expiresAt * 1000).toLocaleTimeString() : 'missing',
      ageInMinutes: timestamp ? ((Date.now() - timestamp) / (60 * 1000)).toFixed(1) : 'unknown'
    });
    
    // If saved state is older than 15 minutes, ignore it
    if (Date.now() - timestamp > 15 * 60 * 1000) {
      console.log('Facebook auth state is too old, removing it');
      localStorage.removeItem('fb_auth_state');
      return false;
    }
    
    // Check if we're already logged in
    const { data: { session: existingSession } } = await supabase.auth.getSession();
    if (existingSession) {
      console.log('Already authenticated, no need to restore');
      return true; // Already authenticated
    }
    
    console.log('No active session found, attempting to create one');
    
    // If we got here, we need to attempt a token refresh
    // In a real implementation, you might store the refresh token as well and use it
    // For this basic implementation, we'll try a general refresh
    
    try {
      const { data, error } = await supabase.auth.refreshSession();
      
      if (error) {
        console.error('Failed to refresh session:', error);
        return false;
      }
      
      if (!data.session) {
        console.error('No session returned from refresh');
        return false;
      }
      
      console.log('Successfully restored session');
      
      // Clean up stored state
      localStorage.removeItem('fb_auth_state');
      
      return true;
    } catch (refreshError) {
      console.error('Error refreshing session:', refreshError);
      return false;
    }
  } catch (error) {
    console.error('Error restoring Facebook auth state:', error);
    return false;
  }
}
