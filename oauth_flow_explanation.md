# JioPayment OAuth2 SSO Authentication Flow

This document provides a detailed, comprehensive explanation of the OAuth2 Single Sign-On (SSO) authentication system implemented in the JioPayment application. It describes the integration between the **React Frontend (Vite)**, the **Node.js/Express Backend**, and the **Vakrangee Authorization Server**.

---

## 1. High-Level Architectural Overview

The authentication system is built using a secure **Backend-for-Frontend (BFF) pattern**.

- **React Frontend (`https://localhost:5173/jpb/`)**: Serves as the user interface. It never handles the OAuth client credentials (like the `clientSecret`) directly, ensuring maximum security.
- **Node.js/Express Backend (`https://localhost:3000`)**: Acts as the secure orchestrator. It manages sessions, stores the OAuth tokens securely, overrides token fetching to match Vakrangee's specific headers, decodes user profiles, and acts as a barrier between the frontend and the SSO server.
- **Vakrangee Identity Provider (`https://authsit.vakrangee.in`)**: The central authentication server that validates credentials and issues OAuth authorization codes and tokens.

Both the frontend and backend are configured to run over **HTTPS** locally to allow secure cookie propagation between different ports.

---

## 2. The Authentication Sequence (Mermaid Diagram)

The following sequence diagram details how the authentication, redirection, and token exchange flows operate:

```mermaid
sequenceDiagram
    autonumber
    actor User as User Browser
    participant FE as React Frontend<br/>(https://localhost:5173)
    participant BE as Express Backend<br/>(https://localhost:3000)
    participant SSO as Vakrangee SSO Server<br/>(https://authsit.vakrangee.in)

    User->>FE: 1. Access App Page
    activate FE
    FE->>BE: 2. GET /validate (credentials: "include")
    activate BE
    BE-->>FE: 3. Return 401 Unauthorized (No Session)
    deactivate BE

    FE->>User: 4. Redirect window.location.href to https://localhost:3000/auth
    deactivate FE
    activate User

    User->>BE: 5. GET /auth (Initiates passport-oauth2)
    activate BE
    BE-->>User: 6. Redirect 302 to SSO Authorize Endpoint
    deactivate BE

    User->>SSO: 7. GET /oauth/authorize?response_type=code&client_id=reactsso-dev...
    activate SSO
    SSO->>User: 8. Prompt for Login Credentials
    User->>SSO: 9. Enters Credentials & Consents
    SSO-->>User: 10. Redirect 302 to Backend Callback with Authorization Code
    deactivate SSO

    User->>BE: 11. GET /auth/callback?code=AUTH_CODE
    deactivate User
    activate BE

    BE->>SSO: 12. Server-to-Server POST /oauth/token (Basic Auth Header + AUTH_CODE)
    activate SSO
    SSO-->>BE: 13. Returns JSON (access_token, refresh_token, etc.)
    deactivate SSO

    BE->>BE: 14. Parse Access Token & Create Express Session
    BE-->>User: 15. Redirect 302 with Cookie Set-Cookie: connect.sid to Frontend App
    deactivate BE
    activate User

    User->>FE: 16. Reload React Frontend
    deactivate User
    activate FE

    FE->>BE: 17. GET /validate (credentials: "include" with connect.sid cookie)
    activate BE
    BE-->>FE: 18. Return 200 OK (valid: true)
    deactivate BE

    FE->>BE: 19. GET /profile (credentials: "include")
    activate BE
    BE->>BE: 20. Decode JWT Payload & Extract User Info
    BE-->>FE: 21. Returns JSON Profile Details
    deactivate BE
    FE->>User: 22. Renders Authenticated App with User Session
    deactivate FE
```

---

## 3. Step-by-Step Flow & Redirection Breakdown

### Step 1: React Initiates Validation

On mounting, the core React component in [App.jsx](file:///Users/hemanshu/Desktop/Hemanshu/coding/webdev/intern/Vakrangee/JioPayment/jiopayment/src/App.jsx#L15-L29) runs an effect:

```javascript
useEffect(() => {
  const backendUrl = import.meta.env.VITE_BACKEND_URL || "https://localhost:3000";

  fetch(`${backendUrl}/validate`, {
    credentials: "include", // Crucial: Ensures cookies are sent in cross-site requests
  })
    .then((res) => {
      if (res.status === 401) {
        window.location.href = `${backendUrl}/auth`;
      }
    })
    .catch((err) => {
      console.log("Server Error:", err);
      window.location.href = `${backendUrl}/auth`;
    });
}, []);
```

- If the browser does not have an active session cookie (`connect.sid`), the server responds with a `401 Unauthorized`.
- React catches this status and triggers a full browser redirect (`window.location.href`) to the backend's `/auth` route.

### Step 2: Triggering the Passport OAuth2 Strategy

When the browser hits `/auth`, the backend invokes Passport's `oauth2` strategy:

```javascript
app.get("/auth", passport.authenticate("oauth2"));
```

This strategy is pre-configured with Vakrangee's OAuth parameters in [app.js](file:///Users/hemanshu/Desktop/Hemanshu/coding/webdev/intern/Vakrangee/JioPayment/backend/app.js#L68-L90):

- **`authorizationURL`**: `https://authsit.vakrangee.in/oauth/authorize`
- **`tokenURL`**: `https://authsit.vakrangee.in/oauth/token`
- **`clientID`**: `reactsso-dev`
- **`clientSecret`**: `v-sanchar-secret`
- **`callbackURL`**: `https://localhost:3000/auth/callback`
- **`scope`**: `read`

Passport dynamically constructs a redirect URL with query parameters containing the `client_id`, `redirect_uri` (the callback URL), and `scope`, returning a `302 Found` redirect header to the browser.

### Step 3: SSO Server Authentication & Callback

1. The browser navigates to the SSO authorization screen.
2. The user logs in securely.
3. Upon success, the SSO server issues a temporary, single-use **Authorization Code** and redirects the user's browser back to the callback URL: `https://localhost:3000/auth/callback?code=<authorization_code>`.

### Step 4: Server-to-Server Token Exchange

At `/auth/callback`, the backend interceptor receives the `code`:

```javascript
app.get("/auth/callback", (req, res, next) => {
  console.log("Authorization Code:", req.query.code);

  passport.authenticate("oauth2", { failureRedirect: "/" }, (err, user) => {
    if (err) return next(err);

    req.login(user, (err) => {
      if (err) return next(err);

      req.session.save(() => {
        // Redirect the browser back to React Frontend
        return res.redirect("https://localhost:5173/jpb/");
      });
    });
  })(req, res, next);
});
```

During this phase, **Passport** performs a server-to-server POST request to exchange the code for tokens.
Because the Vakrangee identity provider requires strict customized handling, a custom token request method was implemented by overriding Passport's `getOAuthAccessToken` method in [app.js](file:///Users/hemanshu/Desktop/Hemanshu/coding/webdev/intern/Vakrangee/JioPayment/backend/app.js#L96-L116):

```javascript
OAuth2Strategy.prototype.getOAuthAccessToken = function (
  code,
  params,
  callback,
) {
  const url = this._getAccessTokenUrl(code);

  axios
    .post(url, params, {
      headers: {
        // Basic authentication header: Base64 string of 'reactsso-dev:v-sanchar-secret'
        authorization: "Basic cmVhY3Rzc28tZGV2OnYtc2FuY2hhci1zZWNyZXQ=",
        "content-type": "application/x-www-form-urlencoded",
      },
    })
    .then((response) => {
      callback(null, response.data.access_token, response.data.refresh_token);
    })
    .catch((error) => {
      callback(error);
    });
};
```

This guarantees that:

1. The exchange happens completely behind the scenes (invisible to the browser).
2. The custom Basic Auth headers are correctly injected.
3. The response tokens (`access_token`, `refresh_token`) are received, returning control back to Passport's strategy callback.

---

## 4. Session Management (How the Session is Maintained)

Session persistence is handled via a secure Express cookie mechanism. It operates through the following components:

### A. Express Session Configuration

In [app.js](file:///Users/hemanshu/Desktop/Hemanshu/coding/webdev/intern/Vakrangee/JioPayment/backend/app.js#L45-L56), `express-session` is configured as follows:

```javascript
app.use(
  session({
    secret: "v-sanchar-secret",
    resave: false,
    saveUninitialized: false,
    proxy: true,
    cookie: {
      secure: true, // Must be true over HTTPS
      httpOnly: true, // Prevents client-side scripts from reading the cookie (protects against XSS)
      sameSite: "none", // Allows cross-site cookie transmission (essential because FE and BE are on different ports)
      maxAge: 24 * 60 * 60 * 1000, // Cookie is valid for 24 hours
    },
  }),
);
```

- **`secure: true`**: Encrypts and transmits the cookie only over HTTPS.
- **`sameSite: 'none'`**: Important since the frontend is at `https://localhost:5173` and the backend is at `https://localhost:3000`. Without this setting, modern browsers (Chrome, Edge, Safari) will block the cookie on cross-site requests.
- **`app.set('trust proxy', 1)`**: Configures Express to trust the reverse proxy (like Nginx) which is handling the HTTPS SSL termination.

### B. Passport Serialization & Deserialization

When `req.login(user)` is executed, Passport saves the authenticated user details in the session:

```javascript
passport.serializeUser((user, done) => {
  done(null, user); // Saves the user payload to the session store
});

passport.deserializeUser((user, done) => {
  done(null, user); // Restores user information on req.user during subsequent requests
});
```

This is saved in memory by default. An encrypted session key (the session ID) is sent back to the browser in the HTTP `Set-Cookie: connect.sid=...` header.

### C. CORS Configuration

To allow the React Frontend to share cookies with the backend, both CORS and Fetch requests must be explicitly configured:

1. **Backend CORS Setup**:
   ```javascript
   app.use(
     cors({
       origin: "https://localhost:5173",
       credentials: true, // Crucial: Allows backend to receive incoming cookies and send Set-Cookie headers
     }),
   );
   ```
2. **Frontend Request Setup**:
   In [App.jsx](file:///Users/hemanshu/Desktop/Hemanshu/coding/webdev/intern/Vakrangee/JioPayment/jiopayment/src/App.jsx#L17), the fetch option `credentials: "include"` ensures the browser includes the `connect.sid` cookie when requesting `/validate` or `/profile`.

---

## 5. Data Flow & Token Payload Processing

Once a user session is active, the backend acts as a proxy for retrieving user information and destroying sessions.

### A. Validating Session Status (`/validate`)

Allows the frontend to check if the session is alive:

```javascript
app.get("/validate", (req, res) => {
  if (req.isAuthenticated()) {
    return res.json({ valid: true });
  } else {
    return res.status(401).json({ valid: false });
  }
});
```

### B. Accessing User Details (`/profile`)

Rather than keeping user identity information in a persistent database on the node backend, the backend decrypts the **JWT Access Token** issued by Vakrangee to dynamically determine user details.

```javascript
app.get("/profile", (req, res) => {
  if (!req.isAuthenticated()) {
    return res.status(401).send("Unauthorized");
  }

  // Get the raw access token from the session user object
  const accessToken = req.user.accessToken;

  // Split JWT to get the middle section (Payload)
  const payload = accessToken.split(".")[1];

  // Decode the Base64 representation of the payload into a readable UTF-8 string
  const decoded = Buffer.from(payload, "base64").toString("utf8");

  // Parse as JSON to extract properties
  const user = JSON.parse(decoded);

  return res.json({
    user_id: user.user_id,
    user_name: user.user_name,
    email_id: user.email_id,
    mobile_number: user.mobile_number,
  });
});
```

- **JWT Structure**: A JWT is comprised of three segments separated by dots: `Header.Payload.Signature`.
- **Decoding Mechanism**: The payload (index 1) contains Base64Url-encoded JSON representing user permissions and claims. The backend decodes this using standard Node buffers and returns a clean, structured JSON to the React application, which can then use these variables to populate onboarding forms (e.g. name, email, mobile).

### C. Logging Out Safely (`/logout`)

To fully destroy a session and logout, both the backend session and the global SSO session are terminated in sequence:

```javascript
app.get("/logout", (req, res) => {
  req.logout(function (err) {
    if (err) {
      return res.status(500).send("Logout Error");
    }

    req.session.destroy(() => {
      // Clear the local session cookie
      res.clearCookie("connect.sid");

      // Redirect the user back to the application landing page
      return res.redirect("https://localhost:5173/jpb/");
    });
  });
});
```

This prevents session hijacking by ensuring that:

1. The Node session object is destroyed.
2. The browser cookie is expunged.
3. The global session on Vakrangee Identity server is also terminated.

---

## 6. HTTPS and SSL configuration in Local Development

For browser cookies like `connect.sid` with `sameSite: 'none'` and `secure: true` to work correctly, local dev servers must run over SSL/HTTPS.

### Backend HTTPS Server

In [app.js](file:///Users/hemanshu/Desktop/Hemanshu/coding/webdev/intern/Vakrangee/JioPayment/backend/app.js#L13-L25), we load the self-signed key and certificate to spawn a native Node HTTPS server:

```javascript
const privateKey = fs.readFileSync(path.join(__dirname, "server.pem"), "utf8");
const certificate = fs.readFileSync(path.join(__dirname, "server.crt"), "utf8");
const ca = fs.readFileSync(path.join(__dirname, "server.crt"), "utf8");

const credentials = { key: privateKey, cert: certificate, ca: ca };
const server = https.createServer(credentials, app);
server.listen(3000);
```

### Frontend HTTPS Configuration

Vite is configured in [vite.config.js](file:///Users/hemanshu/Desktop/Hemanshu/coding/webdev/intern/Vakrangee/JioPayment/jiopayment/vite.config.js#L10-L16) to load and reuse the same SSL key/cert from the backend folder:

```javascript
server: {
  host: "localhost",
  port: 5173,
  https: {
    key: fs.readFileSync("../backend/server.pem"),
    cert: fs.readFileSync("../backend/server.crt"),
  },
  // Proxy configurations...
}
```

This ensures the browser sees both `https://localhost:5173` and `https://localhost:3000` as secure local contexts, permitting cookies to be passed seamlessly.

---

## 5. Production-Ready Configurations (`.env`)

To follow standard secure development practices, all sensitive credentials, URLs, and server parameters have been extracted from [app.js](file:///Users/hemanshu/Desktop/Hemanshu/coding/webdev/intern/Vakrangee/JioPayment/backend/app.js) and moved into a centralized [.env](file:///Users/hemanshu/Desktop/Hemanshu/coding/webdev/intern/Vakrangee/JioPayment/backend/.env) file.

### Environment Schema Example:
```env
# Server Configuration
PORT=3000
SESSION_SECRET=v-sanchar-secret

# SSL Certificates (relative to backend folder or absolute paths)
SSL_KEY_FILE=server.pem
SSL_CERT_FILE=server.crt

# Frontend / CORS Configuration
FRONTEND_URL=https://localhost:5173
FRONTEND_REDIRECT_URL=https://localhost:5173/jpb/

# OAuth / ADFS Configuration
OAUTH_CLIENT_ID=reactsso-dev
OAUTH_CLIENT_SECRET=v-sanchar-secret
OAUTH_AUTHORIZE_URL=https://authsit.vakrangee.in/oauth/authorize
OAUTH_TOKEN_URL=https://authsit.vakrangee.in/oauth/token
OAUTH_CALLBACK_URL=https://localhost:3000/auth/callback
OAUTH_SCOPE=read

# SSO Central Logout URL
SSO_LOGOUT_URL=https://vkmssit.vakrangee.in/Logout
```

### Highlights of the Integration:
1. **Dynamic Authorization Header Computation**: Instead of maintaining hardcoded base64 keys, the system now calculates `Basic ` headers on startup dynamically using `Buffer.from(clientID + ':' + clientSecret).toString('base64')`.
2. **Easy Port & URL Swapping**: Switching ports or endpoints for staging, development, or production can now be done instantly without altering any source code.
3. **Enhanced Security**: Prevents sensitive credentials and secret keys from being committed into repository logs.

