import React, { useState, useEffect, useRef } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, BarChart, Bar, PieChart, Pie, Cell } from 'recharts';
import { Facebook, Instagram, Bot, AlertTriangle, MessageCircle, Users, Clock, CheckSquare, BarChart2, RefreshCw, WifiOff } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { getSocialConnections, getVoiceflowMappings, getMessageAnalytics, getDashboardStats, getRecentConversations, getMessageVolumeByHour } from '../lib/api';
import { retryWithBackoff, isNetworkError } from '../lib/errorHandling';
import LoadingIndicator from '../components/LoadingIndicator';
import ErrorAlert from '../components/ErrorAlert';
import type { DashboardStats, SocialConnection, VoiceflowMapping, MessageAnalytics, Conversation, LoadingState, ErrorState } from '../types';

const COLORS = ['#4F46E5', '#06B6D4', '#10B981', '#8B5CF6'];

export default function Dashboard() {
  const [stats, setStats] = useState<DashboardStats>({
    messageCount: 0,
    conversationCount: 0,
    responseTime: 0,
    successRate: 0,
    facebookPercentage: 0,
    instagramPercentage: 0
  });
  const [socialConnections, setSocialConnections] = useState<SocialConnection[]>([]);
  const [voiceflowMapping, setVoiceflowMapping] = useState<VoiceflowMapping | null>(null);
  const [messageAnalytics, setMessageAnalytics] = useState<MessageAnalytics[]>([]);
  const [recentConversations, setRecentConversations] = useState<Conversation[]>([]);
  const [hourlyVolume, setHourlyVolume] = useState<{ hour: number, displayHour: string, count: number }[]>([]);
  const [loading, setLoading] = useState<LoadingState>('loading');
  const [activeMetric, setActiveMetric] = useState<'messages' | 'platforms'>('messages');
  const [error, setError] = useState<ErrorState | null>(null);
  const [isRetrying, setIsRetrying] = useState(false);
  
  // Use a ref to prevent multiple data loads
  const dataLoadedRef = useRef<boolean>(false);

  useEffect(() => {
    // Only load data once
    if (dataLoadedRef.current) return;
    dataLoadedRef.current = true;
    
    loadData();
  }, []);

  async function loadData() {
    try {
      setLoading('loading');
      setError(null);

      // Check if user is authenticated first
      const { data: { session }, error: sessionError } = await supabase.auth.getSession();
      
      if (sessionError) {
        console.error('Error checking session in Dashboard:', sessionError);
        throw new Error(`Authentication error: ${sessionError.message}`);
      }
      
      if (!session) {
        throw new Error('No active session');
      }

      const userId = session.user.id;
      console.log('Dashboard: Loading data for user', userId);

      // Use Promise.allSettled to load all data in parallel and handle errors individually
      const [
        connectionsResult, 
        mappingsResult, 
        statsResult, 
        analyticsResult,
        conversationsResult, 
        hourlyResult
      ] = await Promise.allSettled([
        getSocialConnections(),
        getVoiceflowMappings(),
        getDashboardStats(userId),
        getMessageAnalytics(userId),
        getRecentConversations(userId),
        getMessageVolumeByHour(userId)
      ]);
      
      // Handle each result and set state accordingly
      if (connectionsResult.status === 'fulfilled') {
        setSocialConnections(connectionsResult.value || []);
      }
      
      if (mappingsResult.status === 'fulfilled' && mappingsResult.value?.length > 0) {
        setVoiceflowMapping(mappingsResult.value[0]);
      }
      
      if (statsResult.status === 'fulfilled') {
        setStats(statsResult.value);
      }
      
      if (analyticsResult.status === 'fulfilled') {
        setMessageAnalytics(analyticsResult.value || []);
      }
      
      if (conversationsResult.status === 'fulfilled') {
        setRecentConversations(conversationsResult.value || []);
      }
      
      if (hourlyResult.status === 'fulfilled') {
        setHourlyVolume(hourlyResult.value || []);
      }
      
      // Check for any errors to report
      const failedResults = [
        connectionsResult, 
        mappingsResult, 
        statsResult, 
        analyticsResult,
        conversationsResult, 
        hourlyResult
      ].filter(result => result.status === 'rejected');
      
      if (failedResults.length > 0) {
        console.warn('Some dashboard data failed to load:', 
          failedResults.map(result => 
            result.status === 'rejected' ? result.reason : null
          )
        );
      }
      
      setLoading('success');
    } catch (err) {
      console.error('Error loading dashboard data:', err);
      
      // Check if it's a network error
      if (isNetworkError(err)) {
        setError({
          message: 'Network error occurred while loading dashboard data',
          details: 'Please check your internet connection and try again.'
        });
      } else {
        setError({
          message: 'Failed to load dashboard data',
          details: err instanceof Error ? err.message : 'Unknown error'
        });
      }
      
      setLoading('error');
    }
  }

  const handleRetry = async () => {
    setIsRetrying(true);
    try {
      await loadData();
    } finally {
      setIsRetrying(false);
    }
  };

  const getFacebookConnection = () => {
    return socialConnections.find(conn => conn.fb_page_id);
  };
  
  const getInstagramConnection = () => {
    return socialConnections.find(conn => conn.ig_account_id);
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString();
  };

  const renderNoDataMessage = () => (
    <div className="text-center py-10">
      <BarChart2 className="h-12 w-12 text-gray-400 mx-auto mb-4" />
      <p className="text-gray-500 font-medium">No data available</p>
      <p className="text-gray-400 text-sm mt-1">
        Start conversations to see analytics
      </p>
    </div>
  );

  const renderErrorState = () => (
    <div className="text-center py-10">
      <WifiOff className="h-12 w-12 text-gray-400 mx-auto mb-4" />
      <p className="text-gray-500 font-medium">Unable to load data</p>
      <p className="text-gray-400 text-sm mt-1 mb-4">
        Please check your connection and try again
      </p>
      <button 
        onClick={handleRetry}
        disabled={isRetrying}
        className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-50"
      >
        {isRetrying ? (
          <>
            <div className="animate-spin h-4 w-4 mr-2 border-2 border-b-transparent border-white rounded-full"></div>
            Retrying...
          </>
        ) : (
          <>
            <RefreshCw className="h-4 w-4 mr-2" />
            Retry
          </>
        )}
      </button>
    </div>
  );

  if (loading === 'loading') {
    return <LoadingIndicator message="Loading dashboard data..." />;
  }

  return (
    <div className="space-y-6">
      {error && (
        <ErrorAlert
          message={error.message}
          details={error.details}
          onDismiss={() => setError(null)}
        />
      )}

      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
        <div className="bg-white overflow-hidden shadow rounded-lg">
          <div className="p-5">
            <div className="flex items-center">
              <div className="flex-shrink-0">
                <Facebook className={`h-6 w-6 ${getFacebookConnection() ? 'text-blue-600' : 'text-gray-400'}`} />
              </div>
              <div className="ml-5 w-0 flex-1">
                <dl>
                  <dt className="text-sm font-medium text-gray-500 truncate">Facebook Connected</dt>
                  <dd className="flex items-baseline">
                    <div className="text-2xl font-semibold text-gray-900">
                      {getFacebookConnection() ? 'Active' : 'Not Connected'}
                    </div>
                  </dd>
                </dl>
              </div>
            </div>
          </div>
        </div>

        <div className="bg-white overflow-hidden shadow rounded-lg">
          <div className="p-5">
            <div className="flex items-center">
              <div className="flex-shrink-0">
                <Instagram className={`h-6 w-6 ${getInstagramConnection() ? 'text-pink-600' : 'text-gray-400'}`} />
              </div>
              <div className="ml-5 w-0 flex-1">
                <dl>
                  <dt className="text-sm font-medium text-gray-500 truncate">Instagram Connected</dt>
                  <dd className="flex items-baseline">
                    <div className="text-2xl font-semibold text-gray-900">
                      {getInstagramConnection() ? 'Active' : 'Not Connected'}
                    </div>
                  </dd>
                </dl>
              </div>
            </div>
          </div>
        </div>

        <div className="bg-white overflow-hidden shadow rounded-lg">
          <div className="p-5">
            <div className="flex items-center">
              <div className="flex-shrink-0">
                <Bot className={`h-6 w-6 ${voiceflowMapping ? 'text-indigo-600' : 'text-gray-400'}`} />
              </div>
              <div className="ml-5 w-0 flex-1">
                <dl>
                  <dt className="text-sm font-medium text-gray-500 truncate">Voiceflow Agent</dt>
                  <dd className="flex items-baseline">
                    <div className="text-2xl font-semibold text-gray-900">
                      {voiceflowMapping ? 'Connected' : 'Not Connected'}
                    </div>
                  </dd>
                </dl>
              </div>
            </div>
          </div>
        </div>
      </div>

      {(!getFacebookConnection() && !getInstagramConnection()) || !voiceflowMapping ? (
        <div className="bg-yellow-50 border border-yellow-200 p-4 rounded-md">
          <div className="flex">
            <div className="flex-shrink-0">
              <AlertTriangle className="h-5 w-5 text-yellow-400" />
            </div>
            <div className="ml-3">
              <h3 className="text-sm font-medium text-yellow-800">Setup Required</h3>
              <div className="mt-2 text-sm text-yellow-700">
                <p>You need to {!getFacebookConnection() && !getInstagramConnection() ? 'connect at least one social account' : ''} 
                   {(!getFacebookConnection() && !getInstagramConnection()) && !voiceflowMapping ? ' and ' : ''}
                   {!voiceflowMapping ? 'connect a Voiceflow agent' : ''} to get started.
                </p>
                <p className="mt-1">
                  <a href="/settings" className="font-medium text-yellow-800 underline">Go to Settings</a> to complete the setup.
                </p>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="bg-white shadow rounded-lg">
          <div className="px-4 py-5 sm:p-6">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg leading-6 font-medium text-gray-900">Message Analytics</h3>
              <div className="flex space-x-2">
                <button
                  onClick={() => setActiveMetric('messages')}
                  className={`px-3 py-1 text-sm rounded-md ${
                    activeMetric === 'messages'
                      ? 'bg-indigo-100 text-indigo-700'
                      : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
                >
                  By Day
                </button>
                <button
                  onClick={() => setActiveMetric('platforms')}
                  className={`px-3 py-1 text-sm rounded-md ${
                    activeMetric === 'platforms'
                      ? 'bg-indigo-100 text-indigo-700'
                      : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
                >
                  By Platform
                </button>
              </div>
            </div>
            {loading === 'error' ? renderErrorState() : (
              !messageAnalytics || messageAnalytics.length === 0 ? (
                renderNoDataMessage()
              ) : (
                <div className="h-80">
                  <ResponsiveContainer width="100%" height="100%">
                    {activeMetric === 'messages' ? (
                      <LineChart
                        data={messageAnalytics}
                        margin={{ top: 10, right: 30, left: 0, bottom: 10 }}
                      >
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="name" />
                        <YAxis />
                        <Tooltip />
                        <Legend />
                        <Line type="monotone" dataKey="messages" stroke="#4F46E5" strokeWidth={2} name="Total" />
                        <Line type="monotone" dataKey="userMessages" stroke="#10B981" strokeWidth={2} name="From Users" />
                        <Line type="monotone" dataKey="assistantMessages" stroke="#8B5CF6" strokeWidth={2} name="From Assistant" />
                      </LineChart>
                    ) : (
                      <BarChart
                        data={messageAnalytics}
                        margin={{ top: 10, right: 30, left: 0, bottom: 10 }}
                      >
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="name" />
                        <YAxis />
                        <Tooltip />
                        <Legend />
                        <Bar dataKey="facebook" fill="#1877F2" name="Facebook" />
                        <Bar dataKey="instagram" fill="#E1306C" name="Instagram" />
                      </BarChart>
                    )}
                  </ResponsiveContainer>
                </div>
              )
            )}
          </div>
        </div>

        <div className="bg-white shadow rounded-lg">
          <div className="px-4 py-5 sm:p-6">
            <h3 className="text-lg leading-6 font-medium text-gray-900 mb-4">Message Volume by Hour</h3>
            {loading === 'error' ? renderErrorState() : (
              !hourlyVolume || hourlyVolume.every(item => item.count === 0) ? (
                renderNoDataMessage()
              ) : (
                <div className="h-80">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={hourlyVolume}
                      margin={{ top: 10, right: 30, left: 0, bottom: 10 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="displayHour" />
                      <YAxis />
                      <Tooltip />
                      <Bar dataKey="count" fill="#4F46E5" name="Messages" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 sm:grid-cols-4">
        <div className="bg-white overflow-hidden shadow rounded-lg">
          <div className="px-4 py-5 sm:p-6">
            <div className="flex items-center">
              <MessageCircle className="h-8 w-8 text-indigo-600 mr-3" />
              <div>
                <dt className="text-sm font-medium text-gray-500 truncate">Total Messages</dt>
                <dd className="mt-1 text-3xl font-semibold text-gray-900">{stats.messageCount}</dd>
              </div>
            </div>
          </div>
        </div>

        <div className="bg-white overflow-hidden shadow rounded-lg">
          <div className="px-4 py-5 sm:p-6">
            <div className="flex items-center">
              <Users className="h-8 w-8 text-blue-600 mr-3" />
              <div>
                <dt className="text-sm font-medium text-gray-500 truncate">Conversations</dt>
                <dd className="mt-1 text-3xl font-semibold text-gray-900">{stats.conversationCount}</dd>
              </div>
            </div>
          </div>
        </div>

        <div className="bg-white overflow-hidden shadow rounded-lg">
          <div className="px-4 py-5 sm:p-6">
            <div className="flex items-center">
              <Clock className="h-8 w-8 text-green-600 mr-3" />
              <div>
                <dt className="text-sm font-medium text-gray-500 truncate">Avg. Response Time</dt>
                <dd className="mt-1 text-3xl font-semibold text-gray-900">
                  {stats.responseTime ? stats.responseTime.toFixed(1) : "0"}s
                </dd>
              </div>
            </div>
          </div>
        </div>

        <div className="bg-white overflow-hidden shadow rounded-lg">
          <div className="px-4 py-5 sm:p-6">
            <div className="flex items-center">
              <CheckSquare className="h-8 w-8 text-purple-600 mr-3" />
              <div>
                <dt className="text-sm font-medium text-gray-500 truncate">Success Rate</dt>
                <dd className="mt-1 text-3xl font-semibold text-gray-900">
                  {stats.successRate ? stats.successRate.toFixed(1) : "0"}%
                </dd>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="bg-white shadow rounded-lg">
          <div className="px-4 py-5 sm:p-6">
            <h3 className="text-lg leading-6 font-medium text-gray-900 mb-4">Platform Distribution</h3>
            {loading === 'error' ? renderErrorState() : (
              stats.facebookPercentage === 0 && stats.instagramPercentage === 0 ? (
                renderNoDataMessage()
              ) : (
                <div className="h-64 flex items-center justify-center">
                  <ResponsiveContainer width="70%" height="100%">
                    <PieChart>
                      <Pie
                        data={[
                          { name: 'Facebook', value: stats.facebookPercentage },
                          { name: 'Instagram', value: stats.instagramPercentage }
                        ]}
                        cx="50%"
                        cy="50%"
                        labelLine={true}
                        label={({ name, percent }) => `${name}: ${(percent * 100).toFixed(0)}%`}
                        outerRadius={80}
                        fill="#8884d8"
                        dataKey="value"
                      >
                        {[
                          { name: 'Facebook', value: stats.facebookPercentage },
                          { name: 'Instagram', value: stats.instagramPercentage }
                        ].map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={index === 0 ? '#1877F2' : '#E1306C'} />
                        ))}
                      </Pie>
                      <Tooltip formatter={(value) => `${value.toFixed(1)}%`} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              )
            )}
          </div>
        </div>

        <div className="bg-white shadow rounded-lg">
          <div className="px-4 py-5 sm:p-6">
            <h3 className="text-lg leading-6 font-medium text-gray-900 mb-4">Recent Conversations</h3>
            {loading === 'error' ? renderErrorState() : (
              !recentConversations || recentConversations.length === 0 ? (
                renderNoDataMessage()
              ) : (
                <div className="overflow-hidden">
                  <ul className="divide-y divide-gray-200">
                    {recentConversations.map(conversation => (
                      <li key={conversation.id}>
                        <a href={`/messages/${conversation.id}`} className="block hover:bg-gray-50 p-4">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center">
                              {conversation.platform === 'facebook' ? (
                                <Facebook className="h-5 w-5 text-blue-600 mr-2" />
                              ) : (
                                <Instagram className="h-5 w-5 text-pink-600 mr-2" />
                              )}
                              <span className="text-sm font-medium text-gray-900">
                                {conversation.participant_name || `User ${conversation.participant_id.slice(0, 8)}`}
                              </span>
                            </div>
                            <span className="text-xs text-gray-500">
                              {formatDate(conversation.last_message_at)}
                            </span>
                          </div>
                          {conversation.latest_message && (
                            <p className="mt-1 text-sm text-gray-600 truncate pl-7">
                              {conversation.latest_message.content}
                            </p>
                          )}
                        </a>
                      </li>
                    ))}
                  </ul>
                </div>
              )
            )}
          </div>
        </div>
      </div>
      
      {/* Retry button for all data */}
      {(loading === 'error' || error) && (
        <div className="flex justify-center mt-8">
          <button
            onClick={handleRetry}
            disabled={isRetrying}
            className="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-50"
          >
            {isRetrying ? (
              <>
                <div className="animate-spin h-4 w-4 mr-2 border-2 border-b-transparent border-white rounded-full"></div>
                Refreshing...
              </>
            ) : (
              <>
                <RefreshCw className="h-4 w-4 mr-2" />
                Refresh Dashboard
              </>
            )}
          </button>
        </div>
      )}
    </div>
  );
}