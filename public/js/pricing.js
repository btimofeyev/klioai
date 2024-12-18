// frontend/pricing.js
const API_URL = 'http://localhost:3000';
const stripe = Stripe('pk_live_51MqUNDDII9A9349oqpvBurQTFSJgjUtr7FGkYtZ9I2iJqUGMObMqCYD4Aa5l3061bxybqh1kBQ9uqBxCOsbz4wjc00yR3R1yaC');

const PLANS = {
  single: {
    name: 'Single Account Plan',
    priceId: 'price_1QVLU5DII9A9349o7xJSR3OZ',
    price: 9.99
  },
  familypro: {
    name: 'Family Pro Account Plan',
    priceId: 'price_1QVLUbDII9A9349oEK9fzVp1',
    price: 19.99
  }
};

let selectedPlan = null;
let googleUserData = null;

function initGoogleAuth() {
  const script = document.createElement('script');
  script.src = 'https://accounts.google.com/gsi/client';
  script.async = true;
  script.defer = true;
  document.head.appendChild(script);

  script.onload = () => {
    google.accounts.id.initialize({
      client_id: '459287730958-961bog884pu7h8kr1ir02ifnovbbfire.apps.googleusercontent.com',
      callback: handleGoogleSignIn,
      auto_select: false,
      cancel_on_tap_outside: true,
    });
  };
}

async function handleGoogleSignIn(response) {
  try {
    const ticket = await fetch(`${API_URL}/api/auth/verify-token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        token: response.credential
      })
    });

    const userData = await ticket.json();
    
    if (userData.success) {
      googleUserData = userData.payload;
      // Proceed to Stripe checkout
      initiateStripeCheckout();
    } else {
      throw new Error(userData.error || 'Token verification failed');
    }
  } catch (error) {
    console.error('Authentication error:', error);
    showError('Authentication failed. Please try again.');
  }
}

async function initiateStripeCheckout() {
  try {
    const response = await fetch(`${API_URL}/api/stripe/create-checkout-session`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        planId: selectedPlan,
        priceId: PLANS[selectedPlan].priceId,
        userData: googleUserData
      })
    });

    const session = await response.json();
    
    if (session.error) {
      throw new Error(session.error);
    }

    const result = await stripe.redirectToCheckout({
      sessionId: session.id
    });

    if (result.error) {
      throw new Error(result.error.message);
    }
  } catch (error) {
    console.error('Stripe checkout error:', error);
    showError(error.message);
  }
}

function showModal(plan) {
  selectedPlan = plan;
  const modal = document.getElementById('signupModal');
  const modalTitle = document.getElementById('modalTitle');
  const modalContent = document.getElementById('modalContent');
  
  modalTitle.textContent = `Choose ${PLANS[plan].name}`;
  modalContent.innerHTML = `
    <p>Selected plan: ${PLANS[plan].name}</p>
    <p>Price: $${PLANS[plan].price}/month</p>
    <div id="googleSignInButton"></div>
    <div style="margin-top: 1rem; text-align: center;">
      <p style="color: #666;">Sign in with Google to continue</p>
    </div>
  `;

  modal.style.display = 'flex';
  
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
}

// Add this to your backend authRoutes.js:

router.post('/verify-token', async (req, res) => {
  try {
    const { token } = req.body;
    const ticket = await client.verifyIdToken({
      idToken: token,
      audience: process.env.GOOGLE_CLIENT_ID
    });
    
    const payload = ticket.getPayload();
    res.json({
      success: true,
      payload: {
        email: payload.email,
        name: payload.name,
        picture: payload.picture,
        google_id: payload.sub
      }
    });
  } catch (error) {
    console.error('Token verification error:', error);
    res.status(400).json({
      success: false,
      error: 'Token verification failed'
    });
  }
});