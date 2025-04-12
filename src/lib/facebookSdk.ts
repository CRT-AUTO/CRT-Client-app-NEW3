// Facebook SDK manager for reliable SDK initialization and usage
import { captureError } from './sentry';

// Type definitions for Facebook SDK
interface FacebookSDK {
  init: (options: any) => void;
  AppEvents: { logPageView: () => void };
  getLoginStatus: (callback: (response: any) => void) => void;
  XFBML: { parse: (element?: HTMLElement) => void };
  login: (callback: (response: any) => void, options: any) => void;
  api: (path: string, method: string, params: any, callback: any) => void;
}

declare global {
  interface Window {
    FB: FacebookSDK;
    fbAsyncInit: () => void;
    fbSDKLoaded: boolean;
  }
}

// SDK Ready state management
let isSDKInitialized = false;
let isSDKLoading = false;
const sdkReadyCallbacks: Array<() => void> = [];

/**
 * Initialize the Facebook SDK
 */
export function initFacebookSDK(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (isSDKInitialized) {
      resolve();
      return;
    }

    if (isSDKLoading) {
      // If SDK is already loading, add this promise's resolve to the callback queue
      sdkReadyCallbacks.push(resolve);
      return;
    }

    isSDKLoading = true;
    console.log("Starting Facebook SDK initialization");

    // Store the original fbAsyncInit if it exists
    const originalFbAsyncInit = window.fbAsyncInit;

    // Set up our own fbAsyncInit
    window.fbAsyncInit = function() {
      try {
        // Get the app ID directly from the environment variables
        const appId = import.meta.env.VITE_META_APP_ID || "";
        
        if (!appId) {
          console.error("Facebook App ID not found in environment variables");
          reject(new Error("Facebook App ID not configured"));
          return;
        }
        
        // Initialize the SDK
        window.FB.init({
          appId: appId,
          cookie: true,
          xfbml: true,
          version: 'v18.0'
        });
          
        window.FB.AppEvents.logPageView();
        
        console.log("Facebook SDK initialized successfully");
        isSDKInitialized = true;
        window.fbSDKLoaded = true;
        
        // Dispatch a custom event for components to listen for
        const event = new Event('fbSDKLoaded');
        document.dispatchEvent(event);
        window.dispatchEvent(event);
        
        // Call the original fbAsyncInit if it exists
        if (typeof originalFbAsyncInit === 'function') {
          originalFbAsyncInit();
        }
        
        // Call all registered callbacks
        while (sdkReadyCallbacks.length > 0) {
          const cb = sdkReadyCallbacks.shift();
          if (cb) cb();
        }
        
        resolve();
      } catch (error) {
        console.error("Error initializing Facebook SDK:", error);
        if (error instanceof Error) {
          captureError(error, { context: 'Facebook SDK initialization' });
        }
        reject(error);
      }
    };

    // Check if the script is already loaded
    if (document.getElementById('facebook-jssdk')) {
      // If script exists but SDK isn't initialized, it's probably still loading
      console.log("Facebook SDK script already exists, waiting for initialization");
      return;
    }

    // Load the SDK
    console.log("Loading Facebook SDK script");
    try {
      const js = document.createElement('script');
      js.id = 'facebook-jssdk';
      js.src = "https://connect.facebook.net/en_US/sdk.js";
      js.async = true;
      js.defer = true;
      js.crossOrigin = "anonymous";
      js.onerror = (error) => {
        console.error("Failed to load Facebook SDK script:", error);
        isSDKLoading = false;
        reject(new Error("Failed to load Facebook SDK script"));
      };
      
      const fjs = document.getElementsByTagName('script')[0];
      if (fjs && fjs.parentNode) {
        fjs.parentNode.insertBefore(js, fjs);
      } else {
        document.head.appendChild(js);
      }
    } catch (error) {
      console.error("Error loading Facebook SDK script:", error);
      isSDKLoading = false;
      reject(error);
    }
  });
}

/**
 * Check if the Facebook SDK is initialized and ready to use
 */
export function isFacebookSDKReady(): boolean {
  return isSDKInitialized && typeof window.FB !== 'undefined';
}

/**
 * Wait for Facebook SDK to be fully initialized
 * @param timeoutMs Timeout in milliseconds
 */
export function waitForFacebookSDK(timeoutMs: number = 10000): Promise<void> {
  return new Promise((resolve, reject) => {
    // If already initialized, resolve immediately
    if (isFacebookSDKReady()) {
      return resolve();
    }
    
    // Add this promise's resolve to the callback queue
    sdkReadyCallbacks.push(resolve);
    
    // Start initialization if not already started
    if (!isSDKLoading) {
      initFacebookSDK().catch(reject);
    }
    
    // Set timeout
    const timeoutId = setTimeout(() => {
      // Remove this resolve from the callback queue
      const index = sdkReadyCallbacks.indexOf(resolve);
      if (index > -1) {
        sdkReadyCallbacks.splice(index, 1);
      }
      
      reject(new Error(`Facebook SDK initialization timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    
    // Clear timeout if SDK is loaded
    document.addEventListener('fbSDKLoaded', () => {
      clearTimeout(timeoutId);
      resolve();
    }, { once: true });
    
    window.addEventListener('fbSDKLoaded', () => {
      clearTimeout(timeoutId);
      resolve();
    }, { once: true });
  });
}

/**
 * Get Facebook login status with proper error handling
 */
export async function getFacebookLoginStatus(): Promise<any> {
  try {
    // First ensure SDK is ready
    await waitForFacebookSDK();
    
    return new Promise((resolve) => {
      window.FB.getLoginStatus((response) => {
        console.log("Facebook login status response:", response);
        resolve(response);
      });
    });
  } catch (error) {
    console.error("Error getting Facebook login status:", error);
    return { 
      status: 'error', 
      error: error instanceof Error ? error.message : String(error) 
    };
  }
}

/**
 * Login with Facebook with proper error handling
 */
export async function loginWithFacebook(scope: string = "public_profile,email,pages_show_list,pages_messaging"): Promise<any> {
  try {
    // First ensure SDK is ready
    await waitForFacebookSDK();
    
    return new Promise((resolve) => {
      window.FB.login((response) => {
        console.log("Facebook login response:", response);
        if (response.status === 'connected') {
          // Successful login, resolve with the response
          resolve(response);
        } else {
          // Login was not successful
          console.log("Facebook login was not successful:", response);
          resolve(response);
        }
      }, { 
        scope, 
        auth_type: 'rerequest'
      });
    });
  } catch (error) {
    console.error("Error during Facebook login:", error);
    return { 
      status: 'error', 
      error: error instanceof Error ? error.message : String(error) 
    };
  }
}

/**
 * Parse XFBML in the given element
 */
export async function parseXFBML(element?: HTMLElement): Promise<boolean> {
  try {
    // First ensure SDK is ready
    await waitForFacebookSDK();
    
    window.FB.XFBML.parse(element);
    return true;
  } catch (error) {
    console.error("Error parsing XFBML:", error);
    return false;
  }
}

// Initialize the SDK as soon as this module is imported
initFacebookSDK().catch(error => {
  console.error("Failed to initialize Facebook SDK:", error);
});
