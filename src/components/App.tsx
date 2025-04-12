import React, { useEffect, useState, useCallback, useRef } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { supabase, clearSupabaseAuth, refreshSupabaseToken, getSessionWithTimeout, getSessionWithRetry } from './lib/supabase';
import { getCurrentUser } from './lib/auth';
import Layout from './components/Layout';
import Auth from './components/Auth';
import Dashboard from './pages/Dashboard';
import Settings from './pages/Settings';
import Messages from './pages/Messages';
import MessageDetail from './pages/MessageDetail';
import FacebookCallback from './pages/FacebookCallback';
import InstagramCallback from './pages/InstagramCallback';
import DeletionStatus from './pages/DeletionStatus';
import AdminLayout from './pages/admin/AdminLayout';
import AdminDashboard from './pages/admin/AdminDashboard';
import AdminUserManagement from './pages/admin/AdminUserManagement';
import AdminUserDetail from './pages/admin/AdminUserDetail';
import AdminWebhookSetup from './pages/admin/AdminWebhookSetup';
import AppErrorBoundary from './components/AppErrorBoundary';
import ConnectionStatus from './components/ConnectionStatus';
import type { User } from './types';

function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [connectionRetries, setConnectionRetries] = useState(0);
  const [debugInfo, setDebugInfo] = useState<string[]>([]);
  const [forceReset, setForceReset] = useState(false);
  const [signOutInProgress, setSignOutInProgress] = useState(false);
  const [initAttempted, setInitAttempted] = useState(false);
  const [forcedClearCompleted, setForcedClearCompleted] = useState(false);
  const [sessionCheckTimeout, setSessionCheckTimeout] = useState(false);
  const [oauthReturnDetected, setOauthReturnDetected] = useState(false);
  
  // Reference to store timeout ID for session refresh
  const refreshTimerRef = useRef<number | null>(null);

  const addDebugInfo = (message: string) => {
    console.log(`App initialization: ${message}`);
    setDebugInfo(prev => [...prev.slice(-9), message]);
  };

  // Detect OAuth return early to prevent unnecessary authentication clearing
  useEffect(() => {
    // Check for OAuth return indicators in the URL or localStorage
    const isOAuthReturn = 
      window.location.pathname.includes('/oauth/facebook/callback') || 
      window.location.pathname.includes('/oauth/instagram/callback') ||
      localStorage.getItem('fb_auth_state') !== null;
    
    if (isOAuthReturn) {
      addDebugInfo("Detected OAuth return, will skip forced auth clearing");
      setOauthReturnDetected(true);
    }
  }, []);

  // Add the missing authentication listener effect
  useEffect(() => {
    const initializeAuth = async () => {
      try {
        setLoading(true);
        addDebugInfo("Starting initialization");
        addDebugInfo("Checking session");
        
        // Special handling for OAuth returns
        if (oauthReturnDetected) {
          addDebugInfo("Using enhanced session check with retry for OAuth return");
          
          try {
            // Use a longer timeout for OAuth returns (15 seconds)
            const { data: { session } } = await getSessionWithRetry(15000, 1000);
            
            if (session) {
              addDebugInfo(`Found session for user ID: ${session.user.id}`);
              const { data: { user: authUser } } = await supabase.auth.getUser();
              
              if (authUser) {
                addDebugInfo(`User authenticated: ${authUser.id}`);
                setUser(authUser as User);
              } else {
                addDebugInfo("Session exists but no user found");
                setUser(null);
              }
            } else {
              addDebugInfo("No active session found after retry");
              setUser(null);
            }
          } catch (timeoutError) {
            addDebugInfo(`Session check timed out: ${timeoutError instanceof Error ? timeoutError.message : 'Unknown error'}`);
            setSessionCheckTimeout(true);
            addDebugInfo("Session check timed out during OAuth return - attempting to continue");
            addDebugInfo("Detected OAuth return, preserving session state");
            // Don't clear session or set user to null - we'll let the component handle this
          }
        } else {
          // Regular session check for non-OAuth cases
          const { data: { session }, error: sessionError } = await supabase.auth.getSession();
          
          if (sessionError) {
            console.error('Error getting session:', sessionError);
            setUser(null);
          } else if (session) {
            addDebugInfo(`Session found for user ID: ${session.user.id}`);
            const { data: { user: authUser } } = await supabase.auth.getUser();
            
            if (authUser) {
              addDebugInfo(`User authenticated: ${authUser.id}`);
              setUser(authUser as User);
            } else {
              addDebugInfo("Session exists but no user found");
              setUser(null);
            }
          } else {
            addDebugInfo("No active session found");
            setUser(null);
          }
        }
      } catch (err) {
        console.error("Error initializing auth:", err);
        setError(err instanceof Error ? err.message : "Unknown authentication error");
        setUser(null);
      } finally {
        setLoading(false);
        setAuthChecked(true);
      }
    };

    // Schedule session check if initialization is taking too long
    const initTimeout = setTimeout(() => {
      addDebugInfo("Initialization seems to be taking longer than expected");
    }, 10000);

    // Listen for auth state changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        addDebugInfo(`Auth state change: ${event}`);
        
        if (event === 'SIGNED_IN' && session) {
          try {
            const { data: { user: authUser } } = await supabase.auth.getUser();
            
            if (authUser) {
              addDebugInfo(`User signed in: ${authUser.email || authUser.id}`);
              setUser(authUser as User);
            
              // Set up session refresh
              const expiresAt = new Date(session.expires_at * 1000);
              const now = new Date();
              const expiresInSeconds = Math.floor((expiresAt.getTime() - now.getTime()) / 1000);
              
              // Refresh 2 minutes before expiry
              const refreshInSeconds = Math.max(expiresInSeconds - 120, 10);
              addDebugInfo(`New session expires at: ${expiresAt.toLocaleTimeString()}`);
              addDebugInfo(`Setting session refresh in ${refreshInSeconds} seconds`);
              
              // Clear any existing refresh timer
              if (refreshTimerRef.current) {
                clearTimeout(refreshTimerRef.current);
              }
              
              // Set up new timer for refresh
              refreshTimerRef.current = window.setTimeout(() => {
                refreshSupabaseToken().then(success => {
                  addDebugInfo(`Token refresh ${success ? 'succeeded' : 'failed'}`);
                });
              }, refreshInSeconds * 1000);
            }
          } catch (getUserError) {
            console.error('Error getting user after sign in:', getUserError);
          }
        } else if (event === 'SIGNED_OUT') {
          addDebugInfo("User signed out");
          setUser(null);
          // Clear refresh timer on sign out
          if (refreshTimerRef.current) {
            clearTimeout(refreshTimerRef.current);
            refreshTimerRef.current = null;
          }
        }
      }
    );

    // Run the initialization
    if (!oauthReturnDetected && forcedClearCompleted) {
      initializeAuth();
    } else if (oauthReturnDetected) {
      // If it's an OAuth return, initialize auth without waiting for forced clear
      initializeAuth();
    }

    // Cleanup timers and subscription
    return () => {
      subscription.unsubscribe();
      clearTimeout(initTimeout);
      if (refreshTimerRef.current) {
        clearTimeout(refreshTimerRef.current);
      }
    };
  }, [oauthReturnDetected, forcedClearCompleted]);

  useEffect(() => {
    // Check for Facebook return before running clearAuth
    // We don't want to clear auth if we're returning from Facebook
    if (oauthReturnDetected || 
        window.location.pathname.includes('/oauth/facebook/callback') || 
        window.location.pathname.includes('/oauth/instagram/callback') ||
        localStorage.getItem('fb_auth_state') !== null) {
      addDebugInfo("Detected OAuth return, skipping forced clear");
      setForcedClearCompleted(true);
    } else {
      // Not an OAuth return, perform the force clear
      const forceClearAuth = async () => {
        // Skip forced sign out if we're returning from Facebook
        const isFacebookReturn = localStorage.getItem('fb_auth_state') !== null;
        
        if (isFacebookReturn) {
          addDebugInfo("Skipping forced sign out due to Facebook auth return");
          setForcedClearCompleted(true);
          return;
        }
        
        // Only attempt once 
        if (signOutInProgress || initAttempted || forcedClearCompleted) {
          return;
        }
        
        try {
          setSignOutInProgress(true);
          setInitAttempted(true);
          addDebugInfo("Performing forced sign out to clear any stale sessions");
          await clearSupabaseAuth();
          addDebugInfo("Forced sign out completed");
          setForcedClearCompleted(true);
        } catch (err) {
          addDebugInfo(`Error during forced sign out: ${err instanceof Error ? err.message : 'Unknown'}`);
          setForcedClearCompleted(true); // Mark as completed even on error to avoid retries
        } finally {
          setSignOutInProgress(false);
        }
      };
      
      forceClearAuth();
    }
  }, [oauthReturnDetected]);

  // Function to handle connection retries
  const handleConnectionRetry = useCallback(() => {
    setConnectionRetries(prev => prev + 1);
    addDebugInfo(`Connection retry attempt ${connectionRetries + 1}`);
    
    // Try to refresh the token
    refreshSupabaseToken().then(success => {
      addDebugInfo(`Token refresh during retry: ${success ? 'succeeded' : 'failed'}`);
      
      // If token refresh failed and we've tried a few times, try a more drastic approach
      if (!success && connectionRetries >= 2) {
        addDebugInfo("Multiple retries failed, attempting forced reset");
        setForceReset(true);
        
        // Force a page reload as a last resort after multiple failures
        if (connectionRetries >= 4) {
          addDebugInfo("Critical connection issues, forcing page reload");
          window.location.reload();
        }
      }
    });
  }, [connectionRetries]);

  return (
    <AppErrorBoundary>
      <BrowserRouter>
        <Routes>
          <Route path="/auth" element={<Auth />} />
          <Route path="/" element={<Layout user={user} />}>
            <Route index element={<Dashboard />} />
            <Route path="messages" element={<Messages />} />
            <Route path="messages/:id" element={<MessageDetail />} />
            <Route path="settings" element={<Settings />} />
            <Route path="oauth/facebook/callback" element={<FacebookCallback />} />
            <Route path="oauth/instagram/callback" element={<InstagramCallback />} />
            <Route path="deletion-status" element={<DeletionStatus />} />
          </Route>
          <Route path="/admin" element={<AdminLayout user={user} />}>
            <Route index element={<AdminDashboard />} />
            <Route path="users" element={<AdminUserManagement />} />
            <Route path="users/:id" element={<AdminUserDetail />} />
            <Route path="webhooks" element={<AdminWebhookSetup />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
      <ConnectionStatus onRetry={handleConnectionRetry} />
    </AppErrorBoundary>
  );
}

export default App;