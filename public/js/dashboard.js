class Dashboard {
    constructor() {
        this.checkAuthentication();
        this.initializeBasics();
        this.checkSubscriptionStatus();
        this.waitForChildManager();
    }

    checkAuthentication() {
        const token = localStorage.getItem('authToken');
        if (!token) {
            window.location.href = '/login.html';
            return;
        }
        this.setupApiInterceptor(token);
    }

    setupApiInterceptor(token) {
        const originalFetch = window.fetch;
        window.fetch = function(url, options = {}) {
            options.headers = {
                ...options.headers,
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            };
            return originalFetch(url, options);
        };
    }

    initializeBasics() {
        // Cache DOM elements
        this.elements = {
            menuItems: document.querySelectorAll('.menu-item'),
            dashboardSections: document.querySelectorAll('.dashboard-section'),
            logoutBtn: document.getElementById('logoutBtn')
        };

        // Event listeners
        this.elements.menuItems.forEach(item => {
            item.addEventListener('click', (e) => {
                e.preventDefault();
                this.switchSection(e.currentTarget.dataset.section);
            });
        });

        this.elements.logoutBtn?.addEventListener('click', () => this.handleLogout());

        // Initialize first section
        const initialSection = window.location.hash.slice(1) || 'children';
        this.switchSection(initialSection);
    }

    async checkSubscriptionStatus() {
        try {
            const userData = JSON.parse(localStorage.getItem('userData'));
            if (!userData) {
                console.error('No user data found');
                return;
            }

            if (userData.subscription_status === 'canceled') {
                const subscriptionEndDate = new Date(userData.subscription_end_date);
                const today = new Date();
                
                if (today > subscriptionEndDate) {
                    this.showSubscriptionExpiredMessage();
                } else {
                    this.showSubscriptionCanceledMessage(subscriptionEndDate);
                }
            }
        } catch (error) {
            console.error('Error checking subscription status:', error);
        }
    }

    showSubscriptionExpiredMessage() {
        const header = document.querySelector('.section-header');
        if (!header) return;

        const messageContainer = document.createElement('div');
        messageContainer.className = 'subscription-alert alert alert--error';
        messageContainer.innerHTML = `
            <p>Your subscription has expired. Please renew to continue using premium features.</p>
            <a href="https://billing.stripe.com/p/login/test_4gwbJKfAS4TjfxSfYY" 
               class="btn btn--primary" 
               target="_blank">
                Renew Subscription
            </a>
        `;
        header.appendChild(messageContainer);
    }

    showSubscriptionCanceledMessage(endDate) {
        const header = document.querySelector('.section-header');
        if (!header) return;

        const messageContainer = document.createElement('div');
        messageContainer.className = 'subscription-alert alert alert--warning';
        messageContainer.innerHTML = `
            <p>Your subscription has been canceled and will end on ${endDate.toLocaleDateString()}.</p>
            <a href="https://billing.stripe.com/p/login/test_4gwbJKfAS4TjfxSfYY" 
               class="btn btn--outline" 
               target="_blank">
                Manage Subscription
            </a>
        `;
        header.appendChild(messageContainer);
    }

    switchSection(sectionId) {
        this.elements.dashboardSections.forEach(section => {
            section.classList.remove('active');
        });
        this.elements.menuItems.forEach(item => {
            item.classList.remove('active');
        });

        const targetSection = document.getElementById(sectionId);
        const targetMenuItem = document.querySelector(`[data-section="${sectionId}"]`);
        
        if (targetSection) targetSection.classList.add('active');
        if (targetMenuItem) targetMenuItem.classList.add('active');
    }

    handleLogout() {
        localStorage.removeItem('authToken');
        localStorage.removeItem('userData');
        window.location.href = '/login.html';
    }

    waitForChildManager() {
        if (window.childAccountManager) {
            this.childManager = window.childAccountManager;
        } else {
            setTimeout(() => this.waitForChildManager(), 100);
        }
    }
}

// Initialize when document is ready
document.addEventListener('DOMContentLoaded', () => {
    new Dashboard();
});