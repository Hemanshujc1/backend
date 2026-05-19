require('dotenv').config();

const cors = require('cors');
const https = require('https');
const fs = require('fs');
const path = require('path');

const express = require('express');
const passport = require('passport');
const OAuth2Strategy = require('passport-oauth2');
const axios = require('axios');
const session = require('express-session');

// --------------------------------------------------
// SSL CERTIFICATES
// --------------------------------------------------
const privateKey = fs.readFileSync(path.join(__dirname, process.env.SSL_KEY_FILE || 'server.pem'), 'utf8');
const certificate = fs.readFileSync(path.join(__dirname, process.env.SSL_CERT_FILE || 'server.crt'), 'utf8');
const ca = fs.readFileSync(path.join(__dirname, process.env.SSL_CERT_FILE || 'server.crt'), 'utf8');

const credentials = {
  key: privateKey,
  cert: certificate,
  ca: ca
};


const app = express();
app.set('trust proxy', 1);

// --------------------------------------------------
// CORS FOR REACT
// --------------------------------------------------
app.use(cors({
  origin: process.env.FRONTEND_URL || 'https://localhost:5173',
  credentials: true
}));


// --------------------------------------------------
// SESSION
// --------------------------------------------------
app.use(session({
  secret: process.env.SESSION_SECRET || 'v-sanchar-secret',
  resave: false,
  saveUninitialized: false,
  proxy: true,
  cookie: {
    secure: true,
    httpOnly: true,
    sameSite: 'none',
    maxAge: 24 * 60 * 60 * 1000
  }
}));

// --------------------------------------------------
// PASSPORT
// --------------------------------------------------
app.use(passport.initialize());
app.use(passport.session());


// --------------------------------------------------
// OAUTH2 STRATEGY
// --------------------------------------------------
const clientID = process.env.OAUTH_CLIENT_ID || 'reactsso-dev';
const clientSecret = process.env.OAUTH_CLIENT_SECRET || 'v-sanchar-secret';
// Dynamically compute the basicAuthHeader from current clientID and clientSecret to prevent credential mismatches
const basicAuthHeader = 'Basic ' + Buffer.from(clientID + ':' + clientSecret).toString('base64');

const ssoStrategy = new OAuth2Strategy({
    authorizationURL: process.env.OAUTH_AUTHORIZE_URL || 'https://authsit.vakrangee.in/oauth/authorize',
    tokenURL: process.env.OAUTH_TOKEN_URL || 'https://authsit.vakrangee.in/oauth/token',
    clientID: clientID,
    clientSecret: clientSecret,
    callbackURL: process.env.OAUTH_CALLBACK_URL || 'https://localhost:3000/auth/callback',
    scope: process.env.OAUTH_SCOPE || 'read',
    customHeaders: {
      authorization: basicAuthHeader,
      'content-type': 'application/x-www-form-urlencoded'
    }
  },
  function (accessToken, refreshToken, profile, done) {
    console.log('Access Token:', accessToken);
    return done(null, {
      accessToken,
      refreshToken,
      profile
    });
  }
);


// --------------------------------------------------
// CUSTOM TOKEN CALL
// --------------------------------------------------
// In passport-oauth2, the strategy delegates token exchange to the internal node-oauth _oauth2 instance.
// Overriding OAuth2Strategy.prototype.getOAuthAccessToken has no effect because strategy calls _oauth2.getOAuthAccessToken.
// We intercept getOAuthAccessToken on the ssoStrategy._oauth2 instance to route it via Axios, which resolves TLS connection issues.
ssoStrategy._oauth2.getOAuthAccessToken = function (code, params, callback) {
  const url = this._getAccessTokenUrl();

  const postData = {
    ...params,
    client_id: this._clientId,
    client_secret: this._clientSecret
  };
  const codeParam = (postData.grant_type === 'refresh_token') ? 'refresh_token' : 'code';
  postData[codeParam] = code;

  const querystring = require('querystring');
  const serializedData = querystring.stringify(postData);

  console.log('Custom Token Call initiated to url:', url);

  const https = require('https');

  axios.post(url, serializedData, {
    headers: {
      authorization: basicAuthHeader,
      'content-type': 'application/x-www-form-urlencoded'
    },
    httpsAgent: new https.Agent({ rejectUnauthorized: false })
  })
    .then((response) => {
      console.log('Custom Token Call Succeeded!');
      callback(
        null,
        response.data.access_token,
        response.data.refresh_token,
        response.data
      );
    })
    .catch((error) => {
      console.error('Custom Token Call Failed:', error.response ? error.response.data : error.message);
      callback(error);
    });
};

passport.use(ssoStrategy);


// --------------------------------------------------
// ERROR RESPONSE
// --------------------------------------------------
OAuth2Strategy.prototype.parseErrorResponse = function (body) {
  console.log("OAuth2 Error Response:", body);
  return JSON.parse(body);
};


// --------------------------------------------------
// SESSION STORE
// --------------------------------------------------
passport.serializeUser((user, done) => {
  done(null, user);
});

passport.deserializeUser((user, done) => {
  done(null, user);
});


app.get('/', (req, res) => {
  res.send('OAuth Server Running');
});


app.get('/auth', passport.authenticate('oauth2'));


// --------------------------------------------------
// CALLBACK AFTER LOGIN
// --------------------------------------------------
app.get('/auth/callback', (req, res, next) => {
  console.log('Authorization Code:', req.query.code);

  passport.authenticate(
    'oauth2',
    { failureRedirect: '/' },
    (err, user) => {
      if (err) {
        console.error('OAuth Callback Error:', err);
        if (err.oauthError) {
          console.error('OAuth Callback Inner Error:', err.oauthError);
        }
        return next(err);
      }

      req.login(user, (err) => {
        if (err) return next(err);

        req.session.save(() => {
          return res.redirect(process.env.FRONTEND_REDIRECT_URL || 'https://localhost:5173/jpb/');
        });
      });
    }
  )(req, res, next);
});


// --------------------------------------------------
// VALIDATE USER FOR REACT
// --------------------------------------------------
app.get('/validate', (req, res) => {
  if (req.isAuthenticated()) {
    return res.json({ valid: true });
  } else {
    return res.status(401).json({ valid: false });
  }
});


// --------------------------------------------------
// PROFILE DATA
// --------------------------------------------------
app.get('/profile', (req, res) => {
  if (!req.isAuthenticated()) {
    return res.status(401).send('Unauthorized');
  }

  const accessToken = req.user.accessToken;
  const payload = accessToken.split('.')[1];
  const decoded = Buffer.from(payload, 'base64').toString('utf8');
  const user = JSON.parse(decoded);

  return res.json({
    user_id: user.user_id,
    user_name: user.user_name,
    email_id: user.email_id,
    mobile_number: user.mobile_number
  });
});


// --------------------------------------------------
// LOGOUT
// --------------------------------------------------
app.get('/logout', (req, res) => {
  req.logout(function (err) {
    if (err) {
      return res.status(500).send("Logout Error");
    }

    req.session.destroy(() => {
      res.clearCookie('connect.sid');
      return res.redirect(process.env.SSO_LOGOUT_URL || 'https://vkmssit.vakrangee.in/Logout');
    });
  });
});


// --------------------------------------------------
// HTTPS SERVER
// --------------------------------------------------
const server = https.createServer(credentials, app);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server is running on https://localhost:${PORT}`);
});