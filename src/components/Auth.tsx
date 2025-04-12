import React, { useState, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { MessageSquare } from 'lucide-react';
import { supabase } from '../lib/supabase';

interface AuthProps {
  initialError?: string | null;
}

export default function Auth({ initialError = null }: AuthProps) {
  const [loading, setLoading] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isSignUp, setIsSignUp] = useState(false);
  const [error, setError] = useState<string | null>(initialError);
  const [debugInfo, setDebugInfo] = useState<string[]>([]);
  const [authResult, setAuthResult] = useState<any>(null);
  const [isRestoringFacebookAuth, setIsRestoringFacebookAuth] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();

  const addDebugInfo = (message: string) => {
    console.log(message);
    setDebugInfo(prev => {
      // Limit to last 10 messages to prevent memory issues
      const newMessages = [...prev, `${new Date().toISOString().slice(11, 19)}: ${message}`];
      return newMessages.slice(-10);
    });
  };

  useEffect(() => {
    // Check if there's an active session already
    const checkExistingSession = async () => {
      try {
        addDebugInfo('Checking for existing session');
        const { data, error } = await supabase.auth.getSession();
        
        if (error) {
          addDebugInfo(`Session check error: ${error.message}`);
          return;
        }
        
        if (data.session) {
          addDebugInfo(`Found existing session for ${data.session.user.id}`);
          
          // Check if we're being explicitly directed to auth page
          const isDirectNavigation = location.state?.directAuth === true;
          if (!isDirectNavigation) {
            // Go to dashboard since user is already logged in
            navigate('/dashboard');
          } else {
            addDebugInfo('Staying on auth page due to direct navigation');
          }
        } else {
          addDebugInfo('No existing session found');
        }
      } catch (error) {
        addDebugInfo(`Error checking session: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    };
    
    checkExistingSession();
    
    // Handle OAuth return detection
    const checkForOAuthReturnAndAuthState = () => {
      // Check if we're returning from OAuth
      const isFromOAuth = location.state?.fromOAuth || 
        localStorage.getItem('fb_auth_state') !== null ||
        location.pathname.includes('/oauth/');
      
      if (isFromOAuth) {
        setIsRestoringFacebookAuth(true);
        addDebugInfo('Detected return from OAuth flow');
        
        if (location.state?.message) {
          addDebugInfo(`OAuth message: ${location.state.message}`);
          setError(location.state.message);
        }
        
        // Check for any saved auth state
        try {
          const fbState = localStorage.getItem('fb_auth_state');
          if (fbState) {
            const savedState = JSON.parse(fbState);
            if (savedState && savedState.timestamp) {
              const ageInMinutes = (Date.now() - savedState.timestamp) / (60 * 1000);
              addDebugInfo(`OAuth auth state is ${ageInMinutes.toFixed(1)} minutes old`);
              
              if (ageInMinutes > 30) {
                localStorage.removeItem('fb_auth_state');
                addDebugInfo('Removed stale OAuth auth state');
              }
            }
          }
        } catch (e) {
          addDebugInfo(`Error processing OAuth state: ${e instanceof Error ? e.message : 'Unknown'}`);
          localStorage.removeItem('fb_auth_state');
        }
      }
    };
    
    checkForOAuthReturnAndAuthState();
  }, [location, navigate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    addDebugInfo(`Attempting ${isSignUp ? 'signup' : 'login'} with email: ${email}`);

    try {
      let result;
      
      if (isSignUp) {
        result = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: {
              role: 'customer' // Default role for new users
            }
          }
        });
        
        if (result.error) throw result.error;
        addDebugInfo("Signup successful");
        
        // Store result for debugging
        setAuthResult(result);
        
        if (result.data.user && !result.data.session) {
          // Email confirmation is required
          setError('Please check your email to confirm your account before logging in.');
        } else if (result.data.session) {
          // Redirect to dashboard after short delay
          setTimeout(() => {
            navigate('/dashboard');
          }, 500);
        }
      } else {
        result = await supabase.auth.signInWithPassword({
          email,
          password,
        });
        
        if (result.error) throw result.error;
        addDebugInfo("Login successful");
        
        // Store result for debugging
        setAuthResult(result);
        
        // Log session details - helpful for debugging expiration issues
        if (result.data.session) {
          const expiresAt = new Date(result.data.session.expires_at * 1000);
          const now = new Date();
          const expiresInMinutes = Math.round((expiresAt.getTime() - now.getTime()) / 60000);
          
          addDebugInfo(`Session expires in ${expiresInMinutes} minutes (at ${expiresAt.toLocaleTimeString()})`);
          addDebugInfo(`Has refresh token: ${!!result.data.session.refresh_token}`);
          
          // Navigate to dashboard on successful login
          setTimeout(() => {
            navigate('/dashboard');
          }, 500);
        }
      }
    } catch (error) {
      addDebugInfo(`Auth error: ${error instanceof Error ? error.message : 'Unknown error'}`);
      setError(error instanceof Error ? error.message : 'An error occurred');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col justify-center py-12 sm:px-6 lg:px-8">
      <div className="sm:mx-auto sm:w-full sm:max-w-md">
        <div className="flex justify-center">
          <MessageSquare className="h-12 w-12 text-indigo-600" />
        </div>
        <h2 className="mt-6 text-center text-3xl font-extrabold text-gray-900">
          {isSignUp ? 'Create your account' : 'Sign in to your account'}
        </h2>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
        <div className="bg-white py-8 px-4 shadow sm:rounded-lg sm:px-10">
          <form className="space-y-6" onSubmit={handleSubmit}>
            {error && (
              <div className="bg-red-50 border border-red-200 text-red-600 px-4 py-3 rounded-md text-sm">
                {error}
              </div>
            )}
            
            <div>
              <label htmlFor="email" className="block text-sm font-medium text-gray-700">
                Email address
              </label>
              <div className="mt-1">
                <input
                  id="email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="appearance-none block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm placeholder-gray-400 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                />
              </div>
            </div>

            <div>
              <label htmlFor="password" className="block text-sm font-medium text-gray-700">
                Password
              </label>
              <div className="mt-1">
                <input
                  id="password"
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="appearance-none block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm placeholder-gray-400 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                />
              </div>
            </div>

            <div>
              <button
                type="submit"
                disabled={loading}
                className="w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-50"
              >
                {loading ? 'Processing...' : isSignUp ? 'Sign Up' : 'Sign In'}
              </button>
            </div>
          </form>

          <div className="mt-6">
            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-gray-300"></div>
              </div>
              <div className="relative flex justify-center text-sm">
                <span className="px-2 bg-white text-gray-500">Or</span>
              </div>
            </div>

            <div className="mt-6">
              <button
                onClick={() => setIsSignUp(!isSignUp)}
                className="w-full text-center text-sm text-indigo-600 hover:text-indigo-500"
              >
                {isSignUp ? 'Already have an account? Sign in' : "Don't have an account? Sign up"}
              </button>
            </div>
          </div>
          
          {/* Debug information */}
          {debugInfo.length > 0 && (
            <div className="mt-6 p-3 bg-gray-50 rounded-md">
              <div className="flex justify-between items-center">
                <p className="text-xs text-gray-500 font-semibold">Debug Information:</p>
                <button 
                  onClick={() => navigator.clipboard.writeText(JSON.stringify(debugInfo, null, 2))}
                  className="text-xs text-indigo-600 hover:underline"
                >
                  Copy
                </button>
              </div>
              <div className="text-xs text-gray-500 overflow-auto max-h-40 mt-1 space-y-1">
                {debugInfo.map((info, idx) => (
                  <div key={idx} className="bg-white p-1 rounded">{info}</div>
                ))}
              </div>
            </div>
          )}
          
          {/* Auth Result Debug */}
          {authResult && (
            <div className="mt-6 p-3 bg-gray-50 rounded-md">
              <p className="text-xs text-gray-500 font-semibold mb-1">Auth Result:</p>
              <div className="text-xs text-gray-500 max-h-40 overflow-y-auto">
                <pre className="whitespace-pre-wrap">
                  {JSON.stringify({
                    user: authResult.data.user ? {
                      id: authResult.data.user.id,
                      email: authResult.data.user.email,
                      created_at: authResult.data.user.created_at,
                    } : null,
                    session: authResult.data.session ? {
                      expires_at: new Date(authResult.data.session.expires_at * 1000).toLocaleString(),
                      refresh_token: authResult.data.session.refresh_token ? 'Present' : 'None'
                    } : 'None'
                  }, null, 2)}
                </pre>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}