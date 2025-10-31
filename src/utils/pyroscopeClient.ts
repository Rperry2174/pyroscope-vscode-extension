/**
 * Pyroscope API client for querying profiling data
 */

import * as https from 'https';
import * as http from 'http';
import { URL } from 'url';

export interface PyroscopeConfig {
  url: string;
  username?: string;
  password?: string;
  query?: string;
  useConnectAPI?: boolean;
}

export interface QueryOptions {
  query: string;
  from: string; // e.g., "now-1h" or milliseconds timestamp
  until?: string; // e.g., "now" or milliseconds timestamp
  maxNodes?: number;
  labelSelector?: string;
  profileTypeID?: string;
}

/**
 * Parse the query string to extract profileTypeID and labelSelector
 */
function parseQuery(query: string): { profileTypeID: string; labelSelector: string } {
  // Query format: process_cpu:cpu:nanoseconds:cpu:nanoseconds{service_name="my_application_name"}
  // or just: process_cpu:cpu:nanoseconds:cpu:nanoseconds (no labels)
  const labelMatch = query.match(/^([^{]+)(\{.*?\})?$/);
  if (!labelMatch) {
    throw new Error(`Invalid query format: ${query}`);
  }

  const profileTypeID = labelMatch[1].trim();
  const labelSelector = labelMatch[2] || '{}';

  if (!profileTypeID) {
    throw new Error(`Invalid query format: profile type ID is empty`);
  }

  return { profileTypeID, labelSelector };
}

/**
 * Convert relative time string to milliseconds timestamp
 */
function parseTime(timeStr: string): number {
  if (timeStr === 'now') {
    return Date.now();
  }

  if (timeStr.startsWith('now-')) {
    const offset = timeStr.substring(4);
    const now = Date.now();
    const multipliers: { [key: string]: number } = {
      s: 1000,
      m: 60 * 1000,
      h: 60 * 60 * 1000,
      d: 24 * 60 * 60 * 1000,
      w: 7 * 24 * 60 * 60 * 1000,
    };

    const match = offset.match(/^(\d+)([smhdw])$/);
    if (!match) {
      throw new Error(`Invalid time offset format: ${offset}`);
    }

    const value = parseInt(match[1], 10);
    const unit = match[2];
    return now - value * multipliers[unit];
  }

  // Assume it's already a timestamp (milliseconds)
  const timestamp = parseInt(timeStr, 10);
  if (isNaN(timestamp)) {
    throw new Error(`Invalid time format: ${timeStr}`);
  }

  return timestamp;
}

/**
 * Query Pyroscope using Connect API (returns pprof binary)
 */
async function queryConnectAPI(
  config: PyroscopeConfig,
  options: QueryOptions
): Promise<Buffer> {
  const { profileTypeID, labelSelector } = parseQuery(options.query);

  const parsedUrl = new URL(config.url);
  const isHttps = parsedUrl.protocol === 'https:';
  const client = isHttps ? https : http;

  const endpoint = `${config.url}/querier.v1.QuerierService/SelectMergeProfile`;
  const endpointUrl = new URL(endpoint);

  const requestBody = {
    start: parseTime(options.from),
    end: options.until ? parseTime(options.until) : Date.now(),
    labelSelector,
    profileTypeID,
    format: 'pprof', // Explicitly request pprof format
    ...(options.maxNodes && { maxNodes: options.maxNodes }),
  };

  const bodyString = JSON.stringify(requestBody);

  return new Promise<Buffer>((resolve, reject) => {
    const requestOptions = {
      hostname: endpointUrl.hostname,
      port: endpointUrl.port || (isHttps ? 443 : 80),
      path: endpointUrl.pathname + endpointUrl.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(bodyString),
        // eslint-disable-next-line @typescript-eslint/naming-convention
        ...(config.username &&
          config.password && {
            // eslint-disable-next-line @typescript-eslint/naming-convention
            Authorization: `Basic ${Buffer.from(`${config.username}:${config.password}`).toString('base64')}`,
          }),
        // eslint-disable-next-line @typescript-eslint/naming-convention
        ...(config.password && !config.username && {
          // eslint-disable-next-line @typescript-eslint/naming-convention
          Authorization: `Bearer ${config.password}`,
        }),
      },
    };

    const req = client.request(requestOptions, (res) => {
      if (res.statusCode !== 200) {
        let errorBody = '';
        res.on('data', (chunk) => {
          errorBody += chunk.toString();
        });
        res.on('end', () => {
          reject(
            new Error(
              `Pyroscope API request failed: ${res.statusCode} ${res.statusMessage}\n${errorBody}`
            )
          );
        });
        return;
      }

      // Check Content-Type header to understand response format
      const contentType = res.headers['content-type'] || '';
      console.log(`[Pyroscope] Response Content-Type: ${contentType}`);
      console.log(`[Pyroscope] Request body was:`, JSON.stringify(requestBody));
      
      const chunks: Buffer[] = [];
      res.on('data', (chunk) => {
        chunks.push(chunk);
      });
      res.on('end', () => {
        const buffer = Buffer.concat(chunks);
        console.log(`[Pyroscope] Received ${buffer.length} bytes, first 32 bytes:`, buffer.slice(0, 32).toString('hex'));
        
        // The Connect API might return pprof wrapped in a JSON envelope
        // Check if it's JSON first (Connect API typically uses application/json)
        if (contentType.includes('application/json') || contentType.includes('application/connect+json')) {
          try {
            const text = buffer.toString('utf-8');
            const json = JSON.parse(text);
            console.log(`[Pyroscope] Parsed JSON response, keys:`, Object.keys(json));
            
            // Connect API responses often have the data in specific fields
            // Look for pprof data in common fields
            if (json.profile) {
              // If it's base64 encoded
              if (typeof json.profile === 'string') {
                try {
                  const decoded = Buffer.from(json.profile, 'base64');
                  console.log(`[Pyroscope] Decoded base64 pprof data: ${decoded.length} bytes`);
                  resolve(decoded);
                  return;
                } catch (e) {
                  console.log(`[Pyroscope] Profile field is not base64, checking if it's raw bytes`);
                }
              }
            }
            
            // Check for raw bytes array
            if (Array.isArray(json.profile) || Array.isArray(json.data)) {
              const pprofData = json.profile || json.data;
              resolve(Buffer.from(pprofData));
              return;
            }
            
            // If JSON but no pprof field found, log and try to use raw buffer
            console.warn(`[Pyroscope] Got JSON response but no pprof data field found. Full response keys:`, Object.keys(json));
          } catch (e) {
            // Not valid JSON, assume it's raw pprof binary
            console.log(`[Pyroscope] Response is not valid JSON (${e}), treating as raw pprof binary`);
          }
        } else {
          // Content-Type suggests binary, treat as raw pprof
          console.log(`[Pyroscope] Content-Type suggests binary format, treating as raw pprof`);
        }
        
        resolve(buffer);
      });
    });

    req.on('error', (error) => {
      reject(new Error(`Pyroscope API request failed: ${error.message}`));
    });

    req.write(bodyString);
    req.end();
  });
}

/**
 * Query Pyroscope using legacy HTTP API (returns JSON)
 * Note: This returns JSON format, not pprof, so we'd need a different parser
 */
async function queryLegacyAPI(
  config: PyroscopeConfig,
  options: QueryOptions
): Promise<Buffer> {
  const parsedUrl = new URL(config.url);
  const isHttps = parsedUrl.protocol === 'https:';
  const client = isHttps ? https : http;

  const endpoint = `${config.url}/pyroscope/render`;
  const endpointUrl = new URL(endpoint);

  // Build query parameters
  const params = new URLSearchParams({
    query: options.query,
    from: options.from,
    format: 'json', // Request JSON format (not pprof)
    ...(options.until && { until: options.until }),
    ...(options.maxNodes && { maxNodes: options.maxNodes.toString() }),
  });

  endpointUrl.search = params.toString();

  return new Promise<Buffer>((resolve, reject) => {
    const requestOptions = {
      hostname: endpointUrl.hostname,
      port: endpointUrl.port || (isHttps ? 443 : 80),
      path: endpointUrl.pathname + endpointUrl.search,
      method: 'GET',
      headers: {
        // eslint-disable-next-line @typescript-eslint/naming-convention
        ...(config.username &&
          config.password && {
            // eslint-disable-next-line @typescript-eslint/naming-convention
            Authorization: `Basic ${Buffer.from(`${config.username}:${config.password}`).toString('base64')}`,
          }),
        // eslint-disable-next-line @typescript-eslint/naming-convention
        ...(config.password && !config.username && {
          // eslint-disable-next-line @typescript-eslint/naming-convention
          Authorization: `Bearer ${config.password}`,
        }),
      },
    };

    const req = client.request(requestOptions, (res) => {
      if (res.statusCode !== 200) {
        let errorBody = '';
        res.on('data', (chunk) => {
          errorBody += chunk.toString();
        });
        res.on('end', () => {
          reject(
            new Error(
              `Pyroscope API request failed: ${res.statusCode} ${res.statusMessage}\n${errorBody}`
            )
          );
        });
        return;
      }

      const chunks: Buffer[] = [];
      res.on('data', (chunk) => {
        chunks.push(chunk);
      });
      res.on('end', () => {
        const buffer = Buffer.concat(chunks);
        resolve(buffer);
      });
    });

    req.on('error', (error) => {
      reject(new Error(`Pyroscope API request failed: ${error.message}`));
    });

    req.end();
  });
}

/**
 * Query Pyroscope server and return pprof data
 */
export async function queryPyroscope(
  config: PyroscopeConfig,
  options: QueryOptions
): Promise<Buffer> {
  if (!config.url) {
    throw new Error('Pyroscope server URL is not configured');
  }

  // Validate URL
  try {
    new URL(config.url);
  } catch (error) {
    throw new Error(`Invalid Pyroscope server URL: ${config.url}`);
  }

  if (config.useConnectAPI !== false) {
    // Use Connect API (returns pprof binary)
    return queryConnectAPI(config, options);
  } else {
    // Use legacy HTTP API (returns JSON - note: this won't be pprof format)
    console.warn(
      '[Pyroscope] Using legacy HTTP API. Note: This returns JSON format, not pprof. Consider using Connect API instead.'
    );
    return queryLegacyAPI(config, options);
  }
}

