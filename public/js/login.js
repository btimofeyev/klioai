let selectedRole = null;
const isDevelopment = window.location.hostname === 'localhost';
const API_URL = isDevelopment 
    ? 'http://localhost:3000' 
    : '';
const GOOGLE_CLIENT_ID = '459287730958-961bog884pu7h8kr1ir02ifnovbbfire.apps.googleusercontent.com'; 

function initGoogleAuth() {
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;
    document.head.appendChild(script);

    script.onload = () => {
        google.accounts.id.initialize({
            client_id: GOOGLE_CLIENT_ID,
            callback: handleGoogleSignIn,
            auto_select: false,
            cancel_on_tap_outside: true,
        });
    };
}

function selectRole(role) {
    selectedRole = role;
    const modal = document.getElementById('loginModal');
    const modalTitle = document.getElementById('modalTitle');
    const modalContent = document.getElementById('modalContent');

    modalTitle.textContent = `${role === 'parent' ? 'Parent' : 'Child'} Login`;
    
    if (role === 'parent') {
        modalContent.innerHTML = `
            <div class="modal-body">
                <div class="modal-description">
                    <i class="fas fa-user-shield modal-icon"></i>
                    <p>Sign in to your parent account to manage settings and monitor activity</p>
                </div>
                <div id="googleSignInButton"></div>
                <div class="modal-note">
                    <i class="fas fa-info-circle"></i>
                    <p>Use your Google account to continue</p>
                </div>
            </div>
        `;
        
        // Render the Google Sign-In button
        google.accounts.id.renderButton(
            document.getElementById('googleSignInButton'),
            { 
                theme: 'outline',
                size: 'large',
                type: 'standard',
                shape: 'rectangular',
                text: 'continue_with',
                logo_alignment: 'left'
            }
        );
    } else {
        modalContent.innerHTML = `
            <div class="modal-body">
                <div class="modal-description">
                    <i class="fas fa-child modal-icon"></i>
                    <p>Welcome back! Enter your username and password to continue</p>
                </div>
                <form id="childLoginForm" class="login-form">
                    <div class="form-group">
                        <label for="username">
                            <i class="fas fa-user"></i>
                            Username
                        </label>
                        <input type="text" id="username" name="username" required>
                    </div>
                    <div class="form-group">
                        <label for="password">
                            <i class="fas fa-lock"></i>
                            Password
                        </label>
                        <input type="password" id="password" name="password" required>
                    </div>
                    <button type="submit" class="btn btn--primary">
                        <i class="fas fa-sign-in-alt"></i>
                        Login
                    </button>
                </form>
            </div>
        `;

        // Add event listener for child login form
        document.getElementById('childLoginForm').addEventListener('submit', handleChildLogin);
    }

    modal.style.display = 'flex';
}
async function handleChildLogin(event) {
    event.preventDefault();
    
    const username = document.getElementById('username').value;
    const password = document.getElementById('password').value;

    try {
        console.log('Attempting login at:', `${API_URL}/api/auth/child-login`);
        
        const response = await fetch(`${API_URL}/api/auth/child-login`, {

            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            },
            body: JSON.stringify({
                username,
                password
            })
        });

        console.log('Response status:', response.status);
        
        const data = await response.json();
        console.log('Login response:', data);
        
        if (data.success) {
            localStorage.setItem('authToken', data.token);
            localStorage.setItem('userData', JSON.stringify(data.user));
            
            // Change this to the absolute path
            window.location.href = '/chat.html';
        } else {
            throw new Error(data.error || 'Login failed');
        }
    } catch (error) {
        console.error('Login error:', error);
        showError(error.message || 'Login failed. Please check your username and password.');
    }
}
async function handleGoogleSignIn(response) {
    try {
        const result = await fetch(`${API_URL}/api/auth/login`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                token: response.credential,
                role: selectedRole
            })
        });

        const data = await result.json();
        
        if (data.success) {
            localStorage.setItem('authToken', data.token);
            localStorage.setItem('userData', JSON.stringify(data.user));
            
            // Redirect based on role
            if (selectedRole === 'parent') {
                window.location.href = '/dashboard.html';
            } else {
                window.location.href = '/chat';
            }
        } else {
            // Show the error message returned from the server
            throw new Error(data.error || 'Authentication failed');
        }
    } catch (error) {
        console.error('Authentication error:', error);
        showError(error.message || 'Authentication failed. Please try again.');
    }
}
function showError(message) {
    const modalContent = document.getElementById('modalContent');
    modalContent.innerHTML += `
        <div class="error-message">
            ${message}
        </div>
    `;
}

function closeModal() {
    const modal = document.getElementById('loginModal');
    modal.style.display = 'none';
}

// Initialize Google Auth when the page loads
document.addEventListener('DOMContentLoaded', initGoogleAuth);

// Add event listener for closing modal when clicking outside
window.addEventListener('click', (event) => {
    const modal = document.getElementById('loginModal');
    if (event.target === modal) {
        closeModal();
    }
});