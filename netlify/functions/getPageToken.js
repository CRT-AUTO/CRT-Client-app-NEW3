// This function exchanges a user access token for a page access token
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
  
  // Extract parameters from the request
  let userToken, pageId;
  
  if (event.httpMethod === 'GET') {
    userToken = event.queryStringParameters?.token;
    pageId = event.queryStringParameters?.pageId;
  } else if (event.httpMethod === 'POST') {
    try {
      const body = JSON.parse(event.body);
      userToken = body.token;
      pageId = body.pageId;
    } catch (e) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Invalid request body' })
      };
    }
  }
  
  if (!userToken || !pageId) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ error: 'Missing required parameters (token and pageId)' })
    };
  }
  
  try {
    // Special case for the "me/accounts" endpoint - returns list of pages
    if (pageId === 'me/accounts') {
      const response = await axios.get(`https://graph.facebook.com/v18.0/me/accounts`, {
        params: {
          access_token: userToken
        }
      });
      
      const pages = response.data.data || [];
      
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          pages: pages
        })
      };
    }
    
    // Regular case - get token for a specific page
    console.log(`Getting page token for page ID: ${pageId}`);
    
    const response = await axios.get(`https://graph.facebook.com/v18.0/${pageId}`, {
      params: {
        fields: 'access_token,name,category',
        access_token: userToken
      }
    });
    
    if (!response.data.access_token) {
      console.error('No page token returned from Facebook:', response.data);
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Failed to retrieve page token' })
      };
    }
    
    // Calculate expiry date (60 days from now for page tokens)
    const expiryDate = new Date();
    expiryDate.setDate(expiryDate.getDate() + 60);
    
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        pageId: pageId,
        pageName: response.data.name,
        pageCategory: response.data.category,
        accessToken: response.data.access_token,
        expiryDate: expiryDate.toISOString()
      })
    };
    
  } catch (error) {
    console.error('Error getting page token:', error.response?.data || error.message);
    
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ 
        error: error.response?.data?.error?.message || error.message || 'Error retrieving page token'
      })
    };
  }
};