const url = require('url');
const http = require('http');
const https = require('https');
const HttpProxyAgent = require('http-proxy-agent');
const HttpsProxyAgent = require('https-proxy-agent');

const { jsutil } = require('arsenal');
const {
    proxyCompareUrl,
} = require('arsenal').storage.data.external.backendUtils;

const validVerbs = ['HEAD', 'GET', 'POST', 'PUT', 'DELETE'];
const updateVerbs = ['POST', 'PUT'];

/*
 * create a new header object from an existing header object. Similar keys
 * will be ignored if a value has been set for theirlower-cased form
 */
function createHeaders(headers)  {
    if (typeof headers !== 'object') {
        return {};
    }
    const out = {};
    Object.keys(headers).forEach(key => {
        const lowKey = key.toLowerCase();
        if (out[lowKey] === undefined) {
            out[lowKey] = headers[key];
        }
    });
    return out;
}

/**
 * @param {url.URL | string} endpoint -
 * @param {object} [options] -
 * @param {string} options.method - default: 'GET'
 * @param {object} options.headers- http headers
 * @param {boolean} options.json - if true, parse response body to json object
 * @param {function} callback - (error, response, body) => {}
 * @returns {object} request object
 */
function request(endpoint, options, callback) {
    if (!endpoint || typeof endpoint === 'function') {
        throw new Error('Missing target endpoint');
    }

    let cb;
    let opts = {};
    if (typeof options === 'function') {
        cb = jsutil.once(options);
    } else if (typeof options === 'object') {
        opts = JSON.parse(JSON.stringify(options)); // deep-copy
        if (typeof callback === 'function') {
            cb = jsutil.once(callback);
        }
    }

    if (typeof cb !== 'function') {
        throw new Error('Missing request callback');
    }

    if (!(endpoint instanceof url.URL || typeof endpoint === 'string')) {
        return cb(new Error(`Invalid URI ${endpoint}`));
    }

    if (!opts.method) {
        opts.method = 'GET';
    } else if (!validVerbs.includes(opts.method)) {
        return cb(new Error(`Invalid Method ${opts.method}`));
    }

    let reqParams;
    if (typeof endpoint === 'string') {
        try {
           reqParams = url.parse(endpoint);
        } catch (error) {
            return cb(error);
        }
    } else {
        reqParams = url.parse(endpoint.href);
    }
    reqParams.method = opts.method;
    reqParams.headers = createHeaders(opts.headers || {});

    let request;
    if (reqParams.protocol === 'http:') {
        request = http;
        const httpProxy = process.env.HTTP_PROXY || process.env.http_proxy;
        if (!proxyCompareUrl(reqParams.hostname) && httpProxy) {
            reqParams.agent = new HttpProxyAgent(url.parse(httpProxy));
        }
    } else if (reqParams.protocol === 'https:') {
        request = https;
        const httpsProxy = process.env.HTTPS_PROXY || process.env.https_proxy;
        if (!proxyCompareUrl(reqParams.hostname) && httpsProxy) {
            reqParams.agent = new HttpsProxyAgent(url.parse(httpsProxy));
        }
    } else {
        return cb(new Error(`Invalid Protocol ${reqParams.protocol}`));
    }

    let data;
    if (opts.body) {
        if (typeof opts.body === 'object') {
            data = JSON.stringify(opts.body);
            if (!reqParams.headers['content-type']) {
                reqParams.headers['content-type'] = 'application/json';
            }
        } else {
            data = opts.body;
        }
        reqParams.headers['content-length'] = Buffer.byteLength(data);
    }

    const req = request.request(reqParams);
    req.on('error', cb);
    req.on('response', res => {
        let rawData  = '';
        res.on('data', chunk => { rawData += chunk; });
        res.on('end', () => {
            if (res.statusCode >= 400) {
                return cb(new Error(res.statusMessage), res, rawData);
            }

            if (opts.json && rawData) {
                try {
                    const parsed = JSON.parse(rawData);
                    return cb(null, res, parsed);
                } catch (err) {
                    // invalid json response
                    return cb(err, res, null);
                }
            }
            return cb(null, res, rawData);
        });
    });
    if (data !== undefined && updateVerbs.includes(opts.method)) {
        req.write(data);
    }
    req.end();
    return req;
}

function _requestWrapper(method, url, options, callback) {
    let cb = callback;
    const opts = { method };

    if (typeof options === 'object') {
        Object.assign(opts, options);
    } else if (typeof options === 'function') {
        cb = options;
    }
    return request(url, opts, cb);
}

module.exports = {
    request,
    get: (url, opts, cb) => _requestWrapper('GET', url, opts, cb),
    post: (url, opts, cb) => _requestWrapper('POST', url, opts, cb),
    createHeaders,
};
