import React, { useEffect, useState, useRef } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { supabase } from './lib/supabase';
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
  const [debugInfo, setDebugInfo] = useState<string[]>([]);
  
  // Use refs to prevent multiple auth handlers from running
  const authHandlerRef = useRef<boolean>(false);
  const refreshTimerRef = useRef<number | null>(null);

  const addDebugInfo = (message: string) => {
    console.log(`App: ${message}`);
    setDebugInfo(prev => [...prev.slice(-9), message]);
  };

  // Single authentication effect
  useEffect(() => {
    // Prevent multiple authentication handlers from running
    if (authHandlerRef.current) return;
    
    authHandlerRef.current = true;
    
    // Initialization function
    const initializeApp = async () => {
      try {
        setLoading(true);
        addDebugInfo("Starting app initialization");
        
        // First check if we have an active session
        const { data, error: sessionError } = await supabase.auth.getSession();
        
        if (sessionError) {
          addDebugInfo(`Session error: ${sessionError.message}`);
          throw sessionError;
        }
        
        if (!data.session) {
          addDebugInfo("No active session found");
          setUser(null);
          setLoading(false);
          return;
        }
        
        // We have a session, get the user
        addDebugInfo(`Found session for user: ${data.session.user.id}`);
        
        // Get user data
        try {
          const userData = await getCurrentUser();
          
          if (userData) {
            addDebugInfo(`User loaded successfully: ${userData.id}`);
            setUser(userData);
          } else {
            addDebugInfo("User data not found");
            setUser(null);
          }
        } catch (userError) {
          addDebugInfo(`Error getting user: ${userError instanceof Error ? userError.message : 'Unknown'}`);
          setUser(null);
        }
      } catch (error) {
        addDebugInfo(`Initialization error: ${error instanceof Error ? error.message : 'Unknown'}`);
        setError(error instanceof Error ? error.message : 'Unknown error');
      } finally {
        setLoading(false);
      }
    };
    
    // Set up the auth state change listener
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      // Don't respond to every auth state change - only to critical ones
      if (event === 'SIGNED_IN' || event === 'SIGNED_OUT' || event === 'USER_UPDATED') {
        addDebugInfo(`Auth event: ${event}`);
        
        if (event === 'SIGNED_IN' && session) {
          // Get user data and set it
          getCurrentUser().then(userData => {
            if (userData) {
              setUser(userData);
            }
          });
        } else if (event === 'SIGNED_OUT') {
          // Clear user data
          setUser(null);
        }
      }
    });
    
    // Run the initialization
    initializeApp();
    
    // Safety timeout to force render if auth takes too long
    const safetyTimeout = setTimeout(() => {
      if (loading) {
        addDebugInfo("Safety timeout reached - forcing app to render");
        setLoading(false);
      }
    }, 5000);
    
    return () => {
      subscription.unsubscribe();
      clearTimeout(safetyTimeout);
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    };
  }, []);

  // If we're still in the loading state, show a loading indicator
  if (loading) {
    return (
      <div className="min-h-screen flex flex-col justify-center items-center bg-gray-50 p-4">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600 mb-4"></div>
        <p className="text-gray-700 text-lg font-medium">Loading application...</p>
        
        {/* Show debug information */}
        {debugInfo.length > 0 && (
          <div className="mt-8 w-full max-w-md p-4 bg-gray-100 rounded-md text-xs text-gray-600 overflow-y-auto max-h-96">
            <p className="font-semibold mb-2">Debug Information:</p>
            <pre className="whitespace-pre-wrap">
              {debugInfo.map((info, idx) => (
                <div key={idx} className="mb-1">{info}</div>
              ))}
            </pre>
          </div>
        )}
        
        {/* Emergency escape button */}
        {debugInfo.length > 5 && (
          <button 
            onClick={() => {
              setLoading(false);
              window.location.href = '/auth';
            }}
            className="mt-6 px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700"
          >
            Go to Login
          </button>
        )}
      </div>
    );
  }

  return (
    <AppErrorBoundary>
      <BrowserRouter>
        <Routes>
          <Route path="/auth" element={<Auth />} />
          <Route path="/" element={<Layout user={user} />}>
            <Route index element={<Dashboard />} />
            <Route path="dashboard" element={<Dashboard />} />
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
      <ConnectionStatus onRetry={() => {
        // Simple retrigger of session check on connection restore
        getCurrentUser().then(userData => {
          if (userData) {
            setUser(userData);
          }
        });
      }} />
    </AppErrorBoundary>
  );
}

export default App;