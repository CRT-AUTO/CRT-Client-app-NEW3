import { createClient } from '@supabase/supabase-js';

// Get environment variables with more explicit checks
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

// Log configuration state to help with debugging
console.log('Supabase Configuration Status:', { 
  urlConfigured: !!supabaseUrl, 
  keyConfigured: !!supabaseAnonKey,
  url: supabaseUrl ? `${supabaseUrl.substring(0, 8)}...` : 'missing', // Only show beginning for security
  mode: import.meta.env.MODE || 'unknown'
});

// Create a dummy client if environment variables are missing
let supabase;

if (!supabaseUrl || !supabaseAnonKey) {
  console.error('⚠️ Missing Supabase environment variables:', { 
    supabaseUrl: supabaseUrl ? 'set' : 'missing', 
    supabaseAnonKey: supabaseAnonKey ? 'set' : 'missing'
  });
  
  // Create a mock client that returns errors for all operations
  supabase = {
    auth: {
      getSession: async () => ({ data: { session: null }, error: new Error('Supabase not configured') }),
      getUser: async () => ({ data: { user: null }, error: new Error('Supabase not configured') }),
      signOut: async () => ({ error: null }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } }, error: null }),
      refreshSession: async () => ({ data: { session: null }, error: new Error('Supabase not configured') })
    },
    from: () => ({
      select: () => ({ data: null, error: new Error('Supabase not configured') }),
      insert: () => ({ data: null, error: new Error('Supabase not configured') }),
      update: () => ({ data: null, error: new Error('Supabase not configured') }),
      delete: () => ({ data: null, error: new Error('Supabase not configured') }),
    }),
    rpc: () => ({ data: null, error: new Error('Supabase not configured') })
  };
} else {
  // Create the Supabase client with simplified configuration
  supabase = createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false 
    }
  });
  
  // Log successful initialization
  console.log('Supabase client initialized successfully');
}

/**
 * Log Supabase errors with context for better debugging
 * @param context The context or operation where the error occurred
 * @param error The error object from Supabase
 */
export function logSupabaseError(context: string, error: any) {
  console.error(`Supabase Error [${context}]:`, error);
  
  // If we're in production, report to Sentry or other error tracking service
  if (import.meta.env.PROD) {
    try {
      // Dynamically import Sentry to avoid circular dependencies
      import('./sentry').then(Sentry => {
        Sentry.captureException(error, {
          tags: { source: 'supabase' },
          extra: { context }
        });
      }).catch(importError => {
        console.error('Failed to load Sentry for error reporting:', importError);
      });
    } catch (sentryError) {
      console.error('Error reporting to Sentry:', sentryError);
    }
  }
}

// Export the client (either real or mock)
export { supabase };

/**
 * Function with timeout for reliable session checking
 */
export async function getSessionWithTimeout(timeoutMs = 5000): Promise<any> {
  return new Promise((resolve, reject) => {
    // Set a timeout to prevent hanging
    const timeoutId = setTimeout(() => {
      reject(new Error(`Session check timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    
    // Attempt to get the session
    supabase.auth.getSession()
      .then(result => {
        clearTimeout(timeoutId);
        resolve(result);
      })
      .catch(error => {
        clearTimeout(timeoutId);
        reject(error);
      });
  });
}

/**
 * Enhanced session check with retry for OAuth flows
 */
export async function getSessionWithRetry(maxTimeMs = 20000, initialDelayMs = 500): Promise<any> {
  const startTime = Date.now();
  let attempt = 1;
  let lastError: Error | null = null;
  
  console.log(`Starting session check with retry (max time: ${maxTimeMs}ms)`);
  
  while (Date.now() - startTime < maxTimeMs) {
    try {
      const result = await getSessionWithTimeout(5000);
      if (result?.data?.session) {
        console.log(`Session found on attempt ${attempt}`);
        return result;
      }
      
      console.log(`No session on attempt ${attempt}, will retry...`);
      
      // Simple backoff with minimal delay
      const delay = Math.min(initialDelayMs * attempt, 2000);
      
      // Wait before the next attempt
      await new Promise(resolve => setTimeout(resolve, delay));
      attempt++;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      console.warn(`Session check attempt ${attempt} failed:`, lastError.message);
      
      // Shorter delay on error
      await new Promise(resolve => setTimeout(resolve, initialDelayMs));
      attempt++;
    }
  }
  
  // If we've exhausted all time, throw the last error or a timeout error
  throw lastError || new Error(`Session check failed after ${maxTimeMs}ms`);
}

/**
 * Function to check database connectivity
 */
export async function checkSupabaseDB(): Promise<{success: boolean, error?: string}> {
  try {
    console.log('Testing database connection...');
    
    if (!supabaseUrl || !supabaseAnonKey) {
      console.error('Cannot check database: Supabase not configured');
      return { success: false, error: 'Supabase not configured' };
    }
    
    // Try the ping RPC first (most efficient)
    try {
      console.log('Attempting to ping database via RPC...');
      const { data, error } = await supabase.rpc('ping');
      
      if (!error && data === true) {
        console.log('Database ping successful via RPC');
        return { success: true };
      } else {
        console.warn('Ping RPC failed:', error?.message);
      }
    } catch (pingError) {
      console.warn('Ping RPC error:', pingError instanceof Error ? pingError.message : String(pingError));
    }
    
    // Fallback to simple session check
    console.log('Falling back to simple session check...');
    const { error } = await supabase.auth.getSession();
    
    if (error) {
      console.error('Database connection check failed:', error);
      return { success: false, error: `Session check failed: ${error.message}` };
    }
    
    console.log('Database connection is working via session check');
    return { success: true };
  } catch (error) {
    console.error('Database connection check failed:', error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    return { success: false, error: `Connection check exception: ${errorMessage}` };
  }
}

/**
 * Clear Supabase auth session
 */
export async function clearSupabaseAuth() {
  console.log('Clearing Supabase auth session...');
  
  try {
    await supabase.auth.signOut();
    console.log('Auth session cleared successfully');
    return true;
  } catch (error) {
    console.error('Error clearing auth session:', error);
    return false;
  }
}

/**
 * Function to refresh the user's token
 */
export async function refreshSupabaseToken(): Promise<boolean> {
  try {
    // Check if online before attempting refresh
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      console.log('User is offline, skipping token refresh');
      return false;
    }

    console.log('Refreshing Supabase token...');
    
    // Attempt to refresh the session
    const { data, error } = await supabase.auth.refreshSession();
    
    if (error) {
      console.error('Error refreshing session:', error);
      return false;
    }
    
    if (!data.session) {
      console.warn('No session returned from refresh');
      return false;
    }
    
    // Log new session expiry
    const newExpiresAt = new Date(data.session.expires_at * 1000);
    console.log('Refreshed session, new expiry at:', newExpiresAt.toISOString());
    
    return true;
  } catch (error) {
    console.error('Exception during token refresh:', error);
    return false;
  }
}