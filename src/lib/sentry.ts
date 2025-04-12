import * as Sentry from '@sentry/react';

export function initSentry() {
  if (import.meta.env.PROD) {
    // Only initialize in production with valid DSN
    const dsn = import.meta.env.VITE_SENTRY_DSN;
    
    if (dsn && dsn !== 'YOUR_SENTRY_DSN') {
      Sentry.init({
        dsn: dsn,
        integrations: [
          new Sentry.BrowserTracing(),
        ],
        // Performance monitoring
        tracesSampleRate: 0.1, // Capture 10% of transactions for performance monitoring
        // Set sampling based on environment
        environment: import.meta.env.MODE,
        // Only enable in production
        enabled: import.meta.env.PROD,
        // Control which errors are reported
        beforeSend(event) {
          // Don't send certain errors
          if (event.exception && 
              event.exception.values && 
              event.exception.values[0].type === 'NetworkError') {
            // Filter out network errors as they're common and expected
            return null;
          }
          return event;
        },
      });
    } else {
      console.log('Sentry disabled: No valid DSN provided');
    }
  }
}

export function captureError(error: unknown, context: Record<string, any> = {}) {
  console.error('Error captured:', error);
  
  if (import.meta.env.PROD && Sentry.getCurrentHub().getClient()) {
    Sentry.captureException(error, {
      extra: context
    });
  }
}