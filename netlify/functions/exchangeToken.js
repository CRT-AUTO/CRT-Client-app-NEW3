// This is a Netlify serverless function that handles Facebook token exchange
const axios = require('axios');

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
  
  // Extract the 'code' parameter from the query string
  const code = event.queryStringParameters?.code;
  
  if (!code) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ error: 'Missing code parameter' }),
    };
  }

  // Retrieve environment variables
  const appId = process.env.VITE_META_APP_ID;
  const appSecret = process.env.META_APP_SECRET;
  const redirectUri = "https://crt-tech.org/oauth/facebook/callback"; // Hardcoded to match Meta app settings

  // Check that required configuration is present
  if (!appId || !appSecret) {
    console.error('Missing Facebook app configuration:', {
      appId: appId ? 'Set' : 'Missing',
      appSecret: appSecret ? 'Set' : 'Missing'
    });
    
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Server configuration error' }),
    };
  }

  try {
    console.log(`Exchanging code for token with redirect URI: ${redirectUri}`);
    
    // Build the URL for token exchange following Facebook's Graph API documentation
    const tokenExchangeUrl = `https://graph.facebook.com/v18.0/oauth/access_token`;
    
    // Make the server-to-server request to exchange the code for a token
    const response = await axios.get(tokenExchangeUrl, {
      params: {
        client_id: appId,
        redirect_uri: redirectUri,
        client_secret: appSecret,
        code: code
      },
      timeout: 10000 // 10 second timeout
    });
    
    const data = response.data;
    
    if (!data.access_token) {
      console.error('No access token returned from Facebook:', data);
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Failed to retrieve access token' }),
      };
    }

    console.log('Successfully exchanged code for access token');
    
    // Get user's Facebook pages using the new access token
    try {
      const pagesResponse = await axios.get('https://graph.facebook.com/v18.0/me/accounts', {
        params: {
          access_token: data.access_token,
          fields: 'id,name,access_token,category,tasks'
        }
      });
      
      const pages = pagesResponse.data.data || [];
      console.log(`Retrieved ${pages.length} Facebook pages`);
      
      // Log detailed information about the pages response
      console.log('Pages response:', {
        paging: pagesResponse.data.paging || 'No paging info',
        hasData: Array.isArray(pages),
        pageCount: Array.isArray(pages) ? pages.length : 0
      });
      
      // If no pages were found, log detailed user info to help diagnose
      if (pages.length === 0) {
        try {
          console.log('No pages found. Fetching user details for diagnosis...');
          const userResponse = await axios.get('https://graph.facebook.com/v18.0/me', {
            params: {
              access_token: data.access_token,
              fields: 'id,name,email,accounts'
            }
          });
          console.log('User info:', {
            id: userResponse.data.id,
            name: userResponse.data.name,
            hasEmail: !!userResponse.data.email,
            hasAccounts: !!userResponse.data.accounts,
            accountsCount: userResponse.data.accounts?.data?.length || 0
          });
        } catch (userError) {
          console.error('Error fetching user details:', userError.response?.data || userError.message);
        }
        
        // Also check permissions to see what the token has access to
        try {
          console.log('Checking token permissions...');
          const permissionsResponse = await axios.get('https://graph.facebook.com/v18.0/me/permissions', {
            params: {
              access_token: data.access_token
            }
          });
          console.log('Token permissions:', permissionsResponse.data.data);
        } catch (permError) {
          console.error('Error fetching token permissions:', permError.response?.data || permError.message);
        }
      } else {
        // If pages were found, log some details about each page
        pages.forEach((page, index) => {
          console.log(`Page ${index + 1}:`, {
            id: page.id,
            name: page.name,
            category: page.category,
            hasTasks: Array.isArray(page.tasks),
            tasksCount: Array.isArray(page.tasks) ? page.tasks.length : 0,
            hasPageToken: !!page.access_token
          });
        });
      }
      
      // Enhanced response with both token and pages
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          accessToken: data.access_token,
          expiresIn: data.expires_in,
          pages: pages
        }),
      };
      
    } catch (pagesError) {
      console.error('Error fetching Facebook pages:', pagesError.response?.data || pagesError.message);
      
      if (pagesError.response?.data?.error) {
        console.error('Facebook API error details:', pagesError.response.data.error);
      }
      
      // Still return the token, but without pages
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          accessToken: data.access_token,
          expiresIn: data.expires_in,
          pages: [],
          pagesError: 'Failed to fetch pages',
          errorDetails: pagesError.response?.data?.error || pagesError.message
        }),
      };
    }
  } catch (error) {
    console.error('Exception in token exchange:', error.response?.data || error.message);
    
    // Log detailed error information for debugging
    if (error.response?.data?.error) {
      console.error('Facebook API error details:', {
        message: error.response.data.error.message,
        type: error.response.data.error.type,
        code: error.response.data.error.code,
        subcode: error.response.data.error.error_subcode,
        traceId: error.response.data.error.fbtrace_id
      });
    }
    
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ 
        error: error.response?.data?.error?.message || error.message || 'Server error during token exchange'
      }),
    };
  }
};
