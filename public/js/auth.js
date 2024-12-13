const isDevelopment = window.location.hostname === 'localhost';
const API_URL = isDevelopment ? 'http://localhost:3002' : 'https://klioai.com'; 
const GOOGLE_CLIENT_ID = '459287730958-961bog884pu7h8kr1ir02ifnovbbfire.apps.googleusercontent.com';
const stripe = Stripe('pk_test_51MqUNDDII9A9349owycaeVLhmzrRqXdymrMIbdWLMTnMepOTS8XyIfsQkX5ojooPcIKyhNWJl1fj595Rp8BqczKM00zMzj9coJ');

let selectedPlan = null;

window.onload = function() {
    google.accounts.id.initialize({
        client_id: GOOGLE_CLIENT_ID,
        callback: handleGoogleSignIn
    });

    const urlParams = new URLSearchParams(window.location.search);
    const sessionId = urlParams.get('session_id');
    if (sessionId) {
        const googleData = JSON.parse(localStorage.getItem('googleData'));
        if (googleData) {
            completeSignupProcess(googleData.token, sessionId);
        }
    }
};

async function completeSignupProcess(token, sessionId) {
    try {
        const stripeSessionRes = await fetch(`${API_URL}/api/stripe/get-session?sessionId=${sessionId}`);
        const sessionData = await stripeSessionRes.json();

        const response = await fetch(`${API_URL}/api/auth/google`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                token,
                plan: selectedPlan,
                stripeCustomerId: sessionData.customerId,
                stripeSubscriptionId: sessionData.subscriptionId
            })
        });

        const data = await response.json();
        if (data.success) {
            localStorage.setItem('authToken', data.token);
            localStorage.setItem('userData', JSON.stringify(data.user));
            localStorage.removeItem('googleData');
            window.location.href = '/dashboard.html';
        } else {
            console.error('Authentication failed:', data.error);
        }
    } catch (error) {
        console.error('Error completing signup:', error);
    }
}

function showModal(plan) {
    selectedPlan = plan;
    const modal = document.getElementById('signupModal');
    const modalTitle = document.getElementById('modalTitle');
    const modalContent = document.getElementById('modalContent');

    modalTitle.textContent = `Choose ${plan === 'single' ? 'Single Account Plan' : 'Family Pro Account Plan'}`;
    modalContent.innerHTML = `
        <p>Selected plan: ${plan === 'single' ? 'Single Account Plan' : 'Family Pro Account Plan'}</p>
        <p>Price: ${plan === 'single' ? '$9.99' : '$19.99'}/month</p>
        <div id="googleSignInButton"></div>
    `;

    modal.style.display = 'flex';

    google.accounts.id.renderButton(
        document.getElementById('googleSignInButton'),
        { theme: 'outline', size: 'large' }
    );
}

async function handleGoogleSignIn(response) {
    try {
        localStorage.setItem('googleData', JSON.stringify({
            token: response.credential,
            plan: selectedPlan
        }));

        const verifyRes = await fetch(`${API_URL}/api/auth/verify-google-token`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token: response.credential })
        });
        
        const tokenData = await verifyRes.json();
        if (!tokenData.success) {
            throw new Error(tokenData.error || 'Google verification failed');
        }

        const checkoutRes = await fetch(`${API_URL}/api/stripe/create-checkout-session`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ plan: selectedPlan, googleData: tokenData.payload })
        });

        const session = await checkoutRes.json();
        if (session.error) {
            throw new Error(session.error);
        }

        const { error } = await stripe.redirectToCheckout({ sessionId: session.sessionId });
        if (error) {
            throw new Error(error.message);
        }
    } catch (error) {
        console.error('Error:', error);
        const modalContent = document.getElementById('modalContent');
        modalContent.innerHTML += `
            <div class="error-message" style="color: red; margin-top: 1rem;">
                ${error.message}
            </div>
        `;
    }
}

async function handlePaymentSuccess() {
    const googleData = JSON.parse(localStorage.getItem('googleData'));
    if (!googleData) return;

    try {
        const response = await fetch(`${API_URL}/api/auth/google`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token: googleData.token, plan: selectedPlan })
        });

        const data = await response.json();
        if (data.success) {
            localStorage.setItem('token', data.token);
            localStorage.setItem('user', JSON.stringify(data.user));
            localStorage.removeItem('googleData');
            window.location.href = '/dashboard';
        }
    } catch (error) {
        console.error('Error completing authentication:', error);
    }
}

function closeModal() {
    document.getElementById('signupModal').style.display = 'none';
}

window.onclick = function(event) {
    const modal = document.getElementById('signupModal');
    if (event.target === modal) {
        closeModal();
    }
};
