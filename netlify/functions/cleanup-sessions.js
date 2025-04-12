// This is a Netlify serverless function to clean up expired sessions
// It should be called periodically (e.g., once a day)

const { createClient } = require('@supabase/supabase-js');

// Initialize Supabase client
const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;
let supabase = null;

if (supabaseUrl && supabaseServiceKey) {
  supabase = createClient(supabaseUrl, supabaseServiceKey);
  console.log("Supabase client initialized successfully in cleanup-sessions");
} else {
  console.warn(`Missing Supabase credentials: URL: ${supabaseUrl ? 'Present' : 'Missing'}, Service Key: ${supabaseServiceKey ? 'Present' : 'Missing'}`);
}

// Function to clean up expired sessions
async function cleanupExpiredSessions() {
  try {
    if (!supabase) {
      throw new Error('Database connection not available');
    }
    
    const now = new Date().toISOString();
    
    const { data, error } = await supabase
      .from('user_sessions')
      .delete()
      .lt('expires_at', now)
      .select();
      
    if (error) throw error;
    
    console.log(`Cleaned up ${data.length} expired sessions`);
    return data.length;
  } catch (error) {
    console.error('Error cleaning up expired sessions:', error);
    throw error;
  }
}

exports.handler = async (event, context) => {
  // Set CORS headers for all responses
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
  };
  
  // Handle preflight requests
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 204,
      headers
    };
  }
  
  try {
    console.log('Starting session cleanup');
    
    // Clean up expired sessions
    const cleanedCount = await cleanupExpiredSessions();
    
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ 
        status: 'success',
        message: `Cleaned up ${cleanedCount} expired sessions`
      })
    };
  } catch (error) {
    console.error('Error cleaning up sessions:', error);
    
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ 
        status: 'error',
        message: 'Error cleaning up sessions',
        error: error.message
      })
    };
  }
};