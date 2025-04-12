// This function gets Instagram business accounts linked to a Facebook page
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
    // First get page access token
    const pageResponse = await axios.get(`https://graph.facebook.com/v18.0/${pageId}`, {
      params: {
        fields: 'access_token',
        access_token: userToken
      }
    });
    
    if (!pageResponse.data.access_token) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Failed to retrieve page access token' })
      };
    }
    
    const pageToken = pageResponse.data.access_token;
    
    // Get Instagram business accounts connected to this page
    const igResponse = await axios.get(`https://graph.facebook.com/v18.0/${pageId}`, {
      params: {
        fields: 'instagram_business_account{id,name,username,profile_picture_url}',
        access_token: pageToken
      }
    });
    
    // Check if the page has an Instagram Business account connected
    if (!igResponse.data.instagram_business_account) {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ 
          accounts: [],
          message: 'No Instagram Business accounts connected to this page' 
        })
      };
    }
    
    // Get more details about the Instagram Business account
    const igAccountId = igResponse.data.instagram_business_account.