const ChatState = {
    childData: null,
    conversationId: null,
    isProcessing: false,
    darkMode: localStorage.getItem('darkMode') === 'true',
    isInitialized: false,
};

const API = {
    baseUrl: window.location.hostname === 'localhost' ? 'http://localhost:3000/api' : '/api',
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
                console.error('API Error:', errorText);
                throw new Error(`Request failed: ${response.status}`);
            }

            return await response.json();
        } catch (error) {
            console.error('API Request Error:', error);
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

const UI = {
    elements: {},

    initialize() {
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
            element ? this.elements[id] = element : missingElements.push(id);
        });

        if (missingElements.length > 0) {
            console.error('Missing elements:', missingElements);
            return false;
        }

        this.initializeEventListeners();
        this.updateTheme();
        return true;
    },

    initializeEventListeners() {
        this.elements.sendMessageBtn.addEventListener('click', () => EventHandlers.handleSendMessage());
        this.elements.messageInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                EventHandlers.handleSendMessage();
            }
        });
        this.elements.newConversationBtn.addEventListener('click', () => EventHandlers.handleNewConversation());
        this.elements.themeToggleBtn.addEventListener('click', () => EventHandlers.handleThemeToggle());
        this.elements.logoutBtn.addEventListener('click', () => EventHandlers.handleLogout());

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
            let formattedMessage = message
                .replace(/^\s*\*\s+/gm, '')
                .replace(/###\s*/g, '')
                .replace(/##\s*/g, '')
                .replace(/#\s*/g, '')
                .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
                .replace(/\*(.*?)\*/g, '<em>$1</em>')
                .replace(/\n\s*\n/g, '\n')
                .trim();

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
                    ${suggestions ? this.createSuggestionChips(suggestions) : ''}
                </div>
            `;
        } else {
            messageElement.innerHTML = `
                <div class="message-content">
                    <p>${message}</p>
                </div>
            `;
        }

        this.elements.chatArea.appendChild(messageElement);
        this.scrollToBottom();
    },

    createSuggestionChips(suggestions) {
        return `
            <div class="suggestion-chips">
                ${suggestions.map(s => `<button class="suggestion-chip">${s}</button>`).join('')}
            </div>
        `;
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
        document.documentElement.setAttribute('data-theme', ChatState.darkMode ? 'dark' : 'light');
        this.elements.themeToggleBtn.innerHTML = ChatState.darkMode
            ? '<i class="fas fa-sun"></i>'
            : '<i class="fas fa-moon"></i>';
    },

    showError(message) {
        alert(message);
    },

    showSuccess(message) {
        const notification = document.createElement('div');
        notification.className = 'success-notification';
        notification.textContent = message;
        document.body.appendChild(notification);
        setTimeout(() => notification.remove(), 3000);
    }
};

const EventHandlers = {
    async handleSendMessage(message = null) {
        if (ChatState.isProcessing) return;

        const messageText = message || UI.elements.messageInput.value.trim();
        if (!messageText) return;

        try {
            ChatState.isProcessing = true;
            UI.showLoading();

            UI.appendMessage('user', messageText);
            UI.elements.messageInput.value = '';

            if (!ChatState.conversationId) {
                const startResponse = await API.post('/chat/conversation/start');
                if (!startResponse.success) throw new Error('Failed to start conversation');
                ChatState.conversationId = startResponse.conversationId;
            }

            const response = await API.post('/chat/message', {
                message: messageText,
                childId: ChatState.childData.id,
                conversationId: ChatState.conversationId
            });

            if (!response.success) {
                throw new Error(response.message || 'Failed to send message');
            }

            UI.appendMessage('ai', response.message, response.suggestions);
        } catch (error) {
            UI.showError(error.message || 'Failed to send message');
        } finally {
            ChatState.isProcessing = false;
            UI.hideLoading();
        }
    },

    async handleNewConversation() {
        try {
            if (UI.elements.chatArea.children.length > 0) {
                if (!confirm('Start a new conversation? This will clear the current chat.')) return;
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
        } catch {
            // Even if it fails, we still logout
        } finally {
            localStorage.clear();
            window.location.href = '/index.html';
        }
    }
};

async function initializeChat() {
    try {
        const authToken = localStorage.getItem('authToken');
        const userData = JSON.parse(localStorage.getItem('userData') || 'null');

        if (!authToken || !userData) {
            window.location.href = '/index.html';
            return;
        }

        if (!UI.initialize()) {
            throw new Error('Failed to initialize UI');
        }

        UI.showLoading();
        ChatState.childData = userData;
        UI.elements.childName.textContent = userData.name || 'Friend';

        const profileResponse = await API.get('/children/profile');
        if (profileResponse.success) {
            ChatState.childData = { ...ChatState.childData, ...profileResponse };
        }

        const activeResponse = await API.get('/chat/conversation/active');
        if (!activeResponse.success || !activeResponse.conversation) {
            await EventHandlers.handleNewConversation();
        } else {
            ChatState.conversationId = activeResponse.conversation.id;
        }

        ChatState.isInitialized = true;
    } catch (error) {
        UI.showError('Failed to initialize chat');
    } finally {
        UI.hideLoading();
    }
}

document.addEventListener('DOMContentLoaded', initializeChat);
