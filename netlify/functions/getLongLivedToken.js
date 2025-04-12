// This function exchanges a short-lived token for a long-lived token (60 days)
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
  
  // Extract the token from the request
  let token;
  
  if (event.httpMethod === 'GET') {
    token = event.queryStringParameters?.token;
  } else if (event.httpMethod === 'POST') {
    try {
      const body = JSON.parse(event.body);
      token = body.token;
    } catch (e) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Invalid request body' })
      };
    }
  }
  
  if (!token) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ error: 'Missing token parameter' })
    };
  }
  
  // Get app credentials from environment
  const appId = process.env.VITE_META_APP_ID;
  const appSecret = process.env.META_APP_SECRET;
  
  if (!appId || !appSecret) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Server configuration error' })
    };
  }
  
  try {
    // Exchange for long-lived token
    // See: https://developers.facebook.com/docs/facebook-login/guides/access-tokens/get-long-lived
    const response = await axios.get('https://graph.facebook.com/v18.0/oauth/access_token', {
      params: {
        grant_type: 'fb_exchange_token',
        client_id: appId,
        client_secret: appSecret,
        fb_exchange_token: token
      }
    });
    
    if (!response.data.access_token) {
      console.error('No long-lived token returned from Facebook:', response.data);
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Failed to retrieve long-lived token' })
      };
    }
    
    // Calculate expiry date (Facebook returns expiry in seconds)
    const expiryDate = new Date();
    expiryDate.setSeconds(expiryDate.getSeconds() + response.data.expires_in);
    
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        accessToken: response.data.access_token,
        expiresIn: response.data.expires_in,
        expiryDate: expiryDate.toISOString()
      })
    };
    
  } catch (error) {
    console.error('Error exchanging for long-lived token:', error.response?.data || error.message);
    
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ 
        error: error.response?.data?.error?.message || error.message || 'Error exchanging token'
      })
    };
  }
};