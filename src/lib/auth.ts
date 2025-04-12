import { supabase, refreshSupabaseToken } from './supabase';
import type { User, AuthStatus } from '../types';

/**
 * Get the current authenticated user with enhanced error handling
 */
export async function getCurrentUser(): Promise<User | null> {
  try {
    console.log('Getting current user...');
    
    // Get the current session first - no token refresh to avoid rate limits
    const { data: { session }, error: sessionError } = await supabase.auth.getSession();
    
    if (sessionError) {
      console.error('Error getting session:', sessionError);
      return null;
    }

    if (!session?.user) {
      console.log('No active session found');
      return null;
    }

    console.log(`Session found for user ID: ${session.user.id}`);
    
    // For faster response, return a minimal user object immediately
    const minimalUser: User = {
      id: session.user.id,
      email: session.user.email || '',
      role: session.user.user_metadata?.role || 'customer',
      created_at: session.user.created_at || new Date().toISOString(),
      isAuthenticated: true
    };

    // Try to get user data from the public users table
    try {
      const { data: userData, error: userError } = await supabase
        .from('users')
        .select('*')
        .eq('id', session.user.id)
        .single();

      if (userError) {
        console.error('Error getting user data from public.users:', userError);
        return minimalUser;
      }

      if (userData) {
        console.log('Found user data in public.users table');
        
        // Try to update last sign-in time and status (non-blocking)
        supabase
          .from('users')
          .update({ 
            last_sign_in: new Date().toISOString(),
            authenticated_status: true
          })
          .eq('id', session.user.id)
          .then(() => console.log('Updated user last_sign_in'))
          .catch(err => console.warn('Failed to update last_sign_in:', err));
        
        return {
          ...userData,
          isAuthenticated: true
        } as User;
      } else {
        console.log('No user record found in public.users table');
        // Return minimal user rather than trying to create a record
        return minimalUser;
      }
    } catch (e) {
      console.error('Exception during user data query:', e);
      return minimalUser;
    }
  } catch (error) {
    console.error('Unexpected error in getCurrentUser:', error);
    return null;
  }
}

/**
 * Check if the current user has admin role
 */
export async function isAdmin(): Promise<boolean> {
  try {
    const { data: { session }, error } = await supabase.auth.getSession();
    
    if (error) {
      console.error('Error getting session:', error);
      return false;
    }

    if (!session?.user) {
      return false;
    }

    // First check user metadata from session
    if (session.user.user_metadata?.role === 'admin') {
      console.log('Admin check from session metadata: true');
      return true;
    }

    // Next try to get role from users table
    try {
      const { data: userData, error: userError } = await supabase
        .from('users')
        .select('role')
        .eq('id', session.user.id)
        .single();

      if (!userError && userData) {
        const isAdminRole = userData.role === 'admin';
        console.log(`Admin check from users table: ${isAdminRole}`);
        return isAdminRole;
      }
    } catch (e) {
      console.error('Error checking admin status in public.users table:', e);
    }

    return false;
  } catch (error) {
    console.error('Error checking admin status:', error);
    return false;
  }
}

/**
 * Get complete authenticated status with user data
 */
export async function getAuthStatus(): Promise<AuthStatus> {
  try {
    // Default status
    const defaultStatus: AuthStatus = {
      isAuthenticated: false,
      isAdmin: false,
      user: null,
      loading: false,
      error: null
    };

    // First check if we have a session
    const { data: { session }, error: sessionError } = await supabase.auth.getSession();
    
    if (sessionError) {
      console.error('Error getting auth status session:', sessionError);
      return {
        ...defaultStatus,
        error: sessionError.message
      };
    }

    if (!session?.user) {
      // No active session
      return defaultStatus;
    }

    // We have a session, get the user data
    const user = await getCurrentUser();
    
    if (!user) {
      return {
        ...defaultStatus,
        isAuthenticated: true, // Session exists but couldn't get full user data
        error: 'Could not retrieve user data'
      };
    }

    // Check admin status
    const adminStatus = await isAdmin();

    return {
      isAuthenticated: true,
      isAdmin: adminStatus,
      user,
      loading: false,
      error: null
    };
  } catch (error) {
    console.error('Error getting auth status:', error);
    return {
      isAuthenticated: false,
      isAdmin: false,
      user: null,
      loading: false,
      error: error instanceof Error ? error.message : 'Unknown error getting auth status'
    };
  }
}

/**
 * Logs the user out by signing out of Supabase auth
 */
export async function logout() {
  try {
    const { error } = await supabase.auth.signOut();
    
    if (error) {
      console.error('Error logging out:', error);
      throw error;
    }

    // Clear all local storage related to auth
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && (key.includes('supabase') || key.includes('sb-'))) {
          localStorage.removeItem(key);
        }
      }
    } catch (e) {
      console.error('Failed to clear local storage during logout:', e);
    }

    // Successfully logged out
    return true;
  } catch (error) {
    console.error('Error during logout:', error);
    throw error;
  }
}

/**
 * Refresh the auth token
 * @returns {Promise<boolean>} True if successful, false otherwise
 */
export async function refreshAuthToken(): Promise<boolean> {
  try {
    console.log('Attempting to refresh auth token...');
    
    return await refreshSupabaseToken();
  } catch (error) {
    console.error('Exception during token refresh:', error);
    return false;
  }
}