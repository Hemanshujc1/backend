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
const privateKey = fs.readFileSync(path.join(__dirname, 'server.pem'), 'utf8');
const certificate = fs.readFileSync(path.join(__dirname, 'server.crt'), 'utf8');
const ca = fs.readFileSync(path.join(__dirname, 'server.crt'), 'utf8');

const credentials = {
  key: privateKey,
  cert: certificate,
  ca: ca
};


// --------------------------------------------------
// EXPRESS APP
// --------------------------------------------------
const app = express();

app.set('trust proxy', 1);
// --------------------------------------------------
// CORS FOR REACT
// --------------------------------------------------
app.use(cors({
  origin: 'https://localhost:5173',
  credentials: true
}));


// --------------------------------------------------
// SESSION
// --------------------------------------------------
app.use(session({
  secret: 'v-sanchar-secret',
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
passport.use(new OAuth2Strategy({
    authorizationURL: 'https://authsit.vakrangee.in/oauth/authorize',
    tokenURL: 'https://authsit.vakrangee.in/oauth/token',
    clientID: 'reactsso-dev',
    clientSecret: 'v-sanchar-secret',
    callbackURL: 'https://localhost:3000/auth/callback',
    scope: 'read',
    customHeaders: {
      authorization: 'Basic cmVhY3Rzc28tZGV2OnYtc2FuY2hhci1zZWNyZXQ=',
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
));


// --------------------------------------------------
// CUSTOM TOKEN CALL
// --------------------------------------------------
OAuth2Strategy.prototype.getOAuthAccessToken = function (code, params, callback) {

  const url = this._getAccessTokenUrl(code);

  axios.post(url, params, {
    headers: {
      authorization: 'Basic cmVhY3Rzc28tZGV2OnYtc2FuY2hhci1zZWNyZXQ=',
      'content-type': 'application/x-www-form-urlencoded'
    }
  })
    .then((response) => {
      callback(
        null,
        response.data.access_token,
        response.data.refresh_token
      );
    })
    .catch((error) => {
      callback(error);
    });
};


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


// --------------------------------------------------
// DEFAULT HOME
// --------------------------------------------------
app.get('/', (req, res) => {
  res.send('OAuth Server Running');
});


// --------------------------------------------------
// LOGIN START
// --------------------------------------------------
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
        return next(err);
      }

     req.login(user, (err) => {
  if (err) return next(err);

  req.session.save(() => {
    return res.redirect('https://localhost:5173/jpb/');
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

      return res.redirect(
                'https://vkmssit.vakrangee.in/Logout'

      );

    });

  });

});

// --------------------------------------------------
// HTTPS SERVER
// --------------------------------------------------
const server = https.createServer(credentials, app);

server.listen(3000, () => {
  console.log('Server is running on https://localhost:3000');
});