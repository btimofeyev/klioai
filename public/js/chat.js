const ChatState = {
    childData: null,
    conversationId: null,
    isProcessing: false,
    darkMode: localStorage.getItem('darkMode') === 'true',
    isInitialized: false,
};

// API Service
const isDevelopment = window.location.hostname === 'localhost';
const API_URL = isDevelopment 
    ? 'http://localhost:3002' 
    : 'https://klioai.com'; 

const API = {
    baseUrl: API_URL,
    async request(endpoint, options = {}) {
        try {
            const authToken = localStorage.getItem('authToken');
            if (!authToken) throw new Error('No authentication token found');

            const response = await fetch(`${this.baseUrl}${endpoint}`, {
                ...options,
                headers: {
                    'Authorization': `Bearer ${authToken}`,
                    'Accept': 'application/json',
                    'Content-Type': 'application/json',
                    ...options.headers,
                },
            });

            if (!response.ok) {
                const errorText = await response.text();
                console.error('Server error:', errorText);
                throw new Error(`Request failed: ${response.status}`);
            }

            return await response.json();
        } catch (error) {
            console.error('API Error:', error);
            throw error;
        }
    },

    get(endpoint) {
        return this.request(endpoint, { method: 'GET' });
    },

    post(endpoint, data) {
        return this.request(endpoint, {
            method: 'POST',
            body: JSON.stringify(data),
        });
    }
};

// UI Manager
const UI = {
    elements: {},

    initialize() {
        // Get all required elements
        const requiredElements = [
            'childName',
            'chatArea',
            'messageInput',
            'sendMessageBtn',
            'newConversationBtn',
            'themeToggleBtn',
            'logoutBtn',
            'loadingIndicator'
        ];

        let missingElements = [];

        requiredElements.forEach(id => {
            const element = document.getElementById(id);
            if (element) {
                this.elements[id] = element;
            } else {
                missingElements.push(id);
            }
        });

        if (missingElements.length > 0) {
            console.error('Missing elements:', missingElements);
            return false;
        }

        // Initialize event listeners
        this.initializeEventListeners();
        this.updateTheme();
        
        return true;
    },

    initializeEventListeners() {
        // Send message
        this.elements.sendMessageBtn.addEventListener('click', () => {
            EventHandlers.handleSendMessage();
        });

        // Message input enter key
        this.elements.messageInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                EventHandlers.handleSendMessage();
            }
        });

        // New conversation
        this.elements.newConversationBtn.addEventListener('click', () => {
            EventHandlers.handleNewConversation();
        });

        // Theme toggle
        this.elements.themeToggleBtn.addEventListener('click', () => {
            EventHandlers.handleThemeToggle();
        });

        // Logout
        this.elements.logoutBtn.addEventListener('click', () => {
            EventHandlers.handleLogout();
        });

        // Delegate suggestion chip clicks
        this.elements.chatArea.addEventListener('click', (e) => {
            if (e.target.classList.contains('suggestion-chip')) {
                const message = e.target.textContent.trim();
                EventHandlers.handleSendMessage(message);
            }
        });
    },
    appendMessage(sender, message, suggestions = null) {
        const messageElement = document.createElement('div');
        messageElement.className = `message ${sender}-message`;
    
        if (sender === 'ai') {
            // Clean up the message formatting
            let formattedMessage = message
                // Remove asterisks used for bullets
                .replace(/^\s*\*\s+/gm, '')
                // Remove hashtags but keep the text
                .replace(/###\s*/g, '')
                .replace(/##\s*/g, '')
                .replace(/#\s*/g, '')
                // Handle bold text
                .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
                // Handle emphasized text
                .replace(/\*(.*?)\*/g, '<em>$1</em>')
                // Clean up extra whitespace
                .replace(/\n\s*\n/g, '\n')
                .trim();
    
            // Split into sections if there are clear section breaks
            const sections = formattedMessage.split(/(?=Creative and Artsy|Games and Challenges|Let's Play|Getting Started)/g);
            
            formattedMessage = sections.map(section => {
                const [title, ...content] = section.trim().split('\n');
                if (content.length) {
                    return `
                        <div class="message-section">
                            <div class="section-title">${title.trim()}</div>
                            <div class="section-content">
                                ${content.map(line => `<p>${line.trim()}</p>`).join('')}
                            </div>
                        </div>
                    `;
                }
                return `<p>${title.trim()}</p>`;
            }).join('');
    
            messageElement.innerHTML = `
                <div class="message-content">
                    ${formattedMessage}
                    ${suggestions ? createSuggestionChips(suggestions) : ''}
                </div>
            `;
        } else {
            // User message remains simple
            messageElement.innerHTML = `
                <div class="message-content">
                    <p>${message}</p>
                </div>
            `;
        }
    
        this.elements.chatArea.appendChild(messageElement);
        this.scrollToBottom();
    },

    scrollToBottom() {
        this.elements.chatArea.scrollTop = this.elements.chatArea.scrollHeight;
    },

    showLoading() {
        this.elements.loadingIndicator.style.display = 'block';
    },

    hideLoading() {
        this.elements.loadingIndicator.style.display = 'none';
    },

    updateTheme() {
        document.documentElement.setAttribute('data-theme', 
            ChatState.darkMode ? 'dark' : 'light'
        );
        
        this.elements.themeToggleBtn.innerHTML = ChatState.darkMode
            ? '<i class="fas fa-sun"></i>'
            : '<i class="fas fa-moon"></i>';
    },

    showError(message) {
        alert(message); // Could be replaced with a better error UI
    },

    showSuccess(message) {
        const notification = document.createElement('div');
        notification.className = 'success-notification';
        notification.textContent = message;
        document.body.appendChild(notification);

        setTimeout(() => notification.remove(), 3000);
    }
};
function createSuggestionChips(suggestions) {
    return `
        <div class="suggestion-chips">
            ${suggestions.map(suggestion => `
                <button class="suggestion-chip">${suggestion}</button>
            `).join('')}
        </div>
    `;
}
// Event Handlers
const EventHandlers = {
    async handleSendMessage(message = null) {
        if (ChatState.isProcessing) return;

        const messageText = message || UI.elements.messageInput.value.trim();
        if (!messageText) return;

        try {
            ChatState.isProcessing = true;
            UI.showLoading();

            // Add user message to UI
            UI.appendMessage('user', messageText);
            UI.elements.messageInput.value = '';

            // Ensure we have a conversation
            if (!ChatState.conversationId) {
                const startResponse = await API.post('/chat/conversation/start');
                if (!startResponse.success) {
                    throw new Error('Failed to start conversation');
                }
                ChatState.conversationId = startResponse.conversationId;
            }

            // Send message
            const response = await API.post('/chat/message', {
                message: messageText,
                childId: ChatState.childData.id,
                conversationId: ChatState.conversationId
            });

            if (!response.success) {
                throw new Error(response.message || 'Failed to send message');
            }

            // Handle AI response
            UI.appendMessage('ai', response.message, response.suggestions);

        } catch (error) {
            console.error('Send message error:', error);
            UI.showError(error.message || 'Failed to send message');
        } finally {
            ChatState.isProcessing = false;
            UI.hideLoading();
        }
    },

    async handleNewConversation() {
        try {
            if (UI.elements.chatArea.children.length > 0) {
                if (!confirm('Start a new conversation? This will clear the current chat.')) {
                    return;
                }
            }

            UI.showLoading();

            if (ChatState.conversationId) {
                await API.post(`/chat/conversation/${ChatState.conversationId}/end`);
            }

            const response = await API.post('/chat/conversation/start');

            if (response.success) {
                ChatState.conversationId = response.conversationId;
                UI.elements.chatArea.innerHTML = '';
                
                UI.appendMessage('ai', 
                    `Hi ${ChatState.childData?.name || 'there'}! What would you like to talk about?`,
                    ['Tell me a story', 'Let\'s learn something', 'Play a game', 'Help with homework']
                );

                UI.showSuccess('Started new conversation!');
            } else {
                throw new Error('Failed to start new conversation');
            }
        } catch (error) {
            console.error('New conversation error:', error);
            UI.showError('Unable to start new conversation');
        } finally {
            UI.hideLoading();
        }
    },

    handleThemeToggle() {
        ChatState.darkMode = !ChatState.darkMode;
        localStorage.setItem('darkMode', ChatState.darkMode);
        UI.updateTheme();
    },

    async handleLogout() {
        try {
            if (ChatState.conversationId) {
                await API.post(`/chat/conversation/${ChatState.conversationId}/end`);
            }
            localStorage.clear();
            window.location.href = '/index.html';
        } catch (error) {
            console.error('Logout error:', error);
            localStorage.clear();
            window.location.href = '/index.html';
        }
    }
};

// Chat Initialization
async function initializeChat() {
    try {
        // Check authentication
        const authToken = localStorage.getItem('authToken');
        const userData = JSON.parse(localStorage.getItem('userData') || 'null');
        
        if (!authToken || !userData) {
            window.location.href = '/index.html';
            return;
        }

        // Initialize UI
        if (!UI.initialize()) {
            throw new Error('Failed to initialize UI');
        }

        UI.showLoading();

        // Load user data
        ChatState.childData = userData;
        UI.elements.childName.textContent = userData.name || 'Friend';

        // Get profile data
        const profileResponse = await API.get('/children/profile');
        if (profileResponse.success) {
            ChatState.childData = { ...ChatState.childData, ...profileResponse };
        }

        // Get active conversation or start new one
        const activeResponse = await API.get('/chat/conversation/active');

        if (!activeResponse.success || !activeResponse.conversation) {
            await EventHandlers.handleNewConversation();
        } else {
            ChatState.conversationId = activeResponse.conversation.id;
            // Could load conversation history here if needed
        }

        ChatState.isInitialized = true;
        UI.hideLoading();

    } catch (error) {
        console.error('Initialization error:', error);
        UI.showError('Failed to initialize chat');
        UI.hideLoading();
    }
}

// Start initialization when DOM is loaded
document.addEventListener('DOMContentLoaded', initializeChat);