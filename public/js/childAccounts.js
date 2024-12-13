class ChildAccountManager {
    constructor() {
        if (window.childAccountManager) return window.childAccountManager;
        
        this.initialized = false;
        this.initializeElements();
        this.initialize();
        
        // Initialize Stripe with your public key
        this.stripe = Stripe('pk_test_51MqUNDDII9A9349owycaeVLhmzrRqXdymrMIbdWLMTnMepOTS8XyIfsQkX5ojooPcIKyhNWJl1fj595Rp8BqczKM00zMzj9coJ');

        window.childAccountManager = this;
    }

    // Initialization Methods
    initializeElements() {
        this.childrenGrid = document.getElementById('childrenGrid');
    }

    initialize() {
        if (this.initialized) return;
        this.setupEventListeners();
        this.loadChildren();
        this.checkUpgradeSuccess();
        this.initialized = true;
    }

    setupEventListeners() {
        const sidebarUpgradeBtn = document.querySelector('.upgrade-to-pro');
        if (sidebarUpgradeBtn) {
            sidebarUpgradeBtn.addEventListener('click', (e) => this.handleUpgradeClick(e));
        }
    }

    async handleUpgradeClick(e) {
        e.preventDefault();
        try {
            const userData = JSON.parse(localStorage.getItem('userData'));

            if (!userData || !userData.stripe_customer_id) {
                throw new Error('User data not found. Please log in again.');
            }

            const response = await this.makeRequest('/api/stripe/create-upgrade-session', {
                method: 'POST',
                body: JSON.stringify({
                    customerId: userData.stripe_customer_id,
                    currentPlan: userData.plan_type || 'single'
                })
            });

            if (response.error) {
                throw new Error(response.error);
            }

            const { error } = await this.stripe.redirectToCheckout({
                sessionId: response.sessionId
            });

            if (error) {
                throw new Error(error.message);
            }
        } catch (error) {
            this.showError(error.message || 'Unable to process upgrade. Please try again later.');
        }
    }

    // API Methods
    async makeRequest(endpoint, options = {}) {
        const token = Utils.getAuthToken();
        if (!token) {
            Utils.logout();
            return null;
        }

        const defaultOptions = {
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            }
        };

        try {
            const response = await fetch(endpoint, { ...defaultOptions, ...options });
            
            if (response.status === 401) {
                Utils.logout();
                return null;
            }

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            return await response.json();
        } catch (error) {
            throw error;
        }
    }

    async loadChildren() {
        try {
            const data = await this.makeRequest('/api/children');
            if (data?.success) {
                this.renderChildren(data.children);
                this.updateAddChildButton(data.children.length, data.planType);
            }
        } catch (error) {
            this.showError('Failed to load children accounts');
        }
    }

    async editChild(childId) {
        try {
            const data = await this.makeRequest(`/api/children/${childId}`);
            if (!data?.success || !data.child) {
                throw new Error('Failed to fetch child data');
            }

            const formattedChildData = {
                id: data.child.id,
                name: data.child.name,
                age: data.child.age,
                username: data.child.username,
                parentalControls: {
                    dailyMessageLimit: data.child.daily_message_limit || 50,
                    allowedStartTime: data.child.allowed_start_time || '09:00',
                    allowedEndTime: data.child.allowed_end_time || '21:00',
                    filterInappropriate: data.child.filter_inappropriate !== false
                }
            };
            
            this.showAddChildModal(formattedChildData);
        } catch (error) {
            this.showError('Failed to load child data for editing');
        }
    }

    // UI Event Handlers
    handleAddChildClick() {
        this.showAddChildModal();
    }

    async handleEditChild(e, modal, childId) {
        e.preventDefault();
        try {
            const childData = this.getFormData(e.target, true);
            const result = await this.makeRequest(`/api/children/${childId}`, {
                method: 'PUT',
                body: JSON.stringify(childData)
            });
            
            if (result?.success) {
                this.closeModal(modal);
                await this.loadChildren();
                this.showSuccess('Child account updated successfully');
            }
        } catch (error) {
            this.showError(error.message || 'Failed to update child account');
        }
    }

    async handleAddChild(e, modal) {
        e.preventDefault();
        try {
            const childData = this.getFormData(e.target);
            const result = await this.makeRequest('/api/children', {
                method: 'POST',
                body: JSON.stringify(childData)
            });
            
            if (result?.success) {
                this.closeModal(modal);
                await this.loadChildren();
                this.showSuccess('Child account created successfully');
            } else if (result?.message?.includes('upgrade')) {
                this.showUpgradeModal(result.message);
            }
        } catch (error) {
            this.showError(error.message);
        }
    }

    async deleteChildAccount(childId) {
        try {
            const result = await this.makeRequest(`/api/children/${childId}`, {
                method: 'DELETE'
            });

            if (result?.success) {
                const childCard = this.childrenGrid.querySelector(`[data-child-id="${childId}"]`);
                if (childCard) {
                    childCard.remove();
                }
                this.showSuccess('Child account deleted successfully');
            }
        } catch (error) {
            this.showError('Failed to delete child account');
        }
    }

    // UI Rendering Methods
    updateAddChildButton(childCount, planType) {
        let addChildSection = document.querySelector('.add-child-section');
        const childrenSection = document.querySelector('#children .section-header');
        
        if (!addChildSection && childrenSection) {
            addChildSection = document.createElement('div');
            addChildSection.className = 'add-child-section';
            childrenSection.appendChild(addChildSection);
        }

        if (!addChildSection) return;

        const maxChildren = planType === 'familypro' ? 3 : 1;
        addChildSection.innerHTML = this.getAddButtonHtml(childCount, maxChildren, planType);
        
        const addChildBtn = document.getElementById('addChildBtn');
        if (addChildBtn) {
            addChildBtn.addEventListener('click', this.handleAddChildClick.bind(this));
        }
        
        if (childCount >= maxChildren && planType !== 'familypro') {
            const upgradeBtn = document.getElementById('upgradeBtn');
            if (upgradeBtn) {
                upgradeBtn.addEventListener('click', (e) => this.handleUpgradeClick(e));
            }
        }
    }

    checkUpgradeSuccess() {
        const urlParams = new URLSearchParams(window.location.search);
        if (urlParams.get('upgrade_success') === 'true') {
            this.showSuccess('Successfully upgraded to Family Pro! Enjoy your new features.');
            window.history.replaceState({}, '', window.location.pathname);
            this.loadChildren();
        }
    }

    getAddButtonHtml(childCount, maxChildren, planType) {
        if (childCount >= maxChildren) {
            return `
                <div class="add-child-section max-reached">
                    ${planType !== 'familypro' ? `
                        <button class="upgrade-link" id="upgradeBtn">
                            <i class="fas fa-crown"></i>
                            Upgrade to Family Pro
                        </button>
                    ` : ''}
                </div>
            `;
        }
        
        return `
            <button id="addChildBtn" class="add-child-btn">
                <i class="fas fa-plus-circle"></i>
                <span>Add Child Account</span>
                <span class="account-count">
                    <span class="count-number">${childCount}</span>
                    <span class="count-separator">/</span>
                    <span class="count-limit">${maxChildren}</span>
                </span>
            </button>
        `;
    }

    renderChildren(children) {
        if (!Array.isArray(children)) return;
        this.childrenGrid.innerHTML = children.map(child => this.createChildCard(child)).join('');
        this.attachCardEventListeners();
    }

    createChildCard(child) {
        const isOnline = new Date(child.last_activity) > new Date(Date.now() - 5 * 60 * 1000);
        
        return `
            <div class="child-card" data-child-id="${child.id}">
                <div class="child-card-header">
                    <div class="child-info">
                        <div class="child-avatar">${child.name[0]}</div>
                        <div class="child-details">
                            <h3>${child.name}</h3>
                            <span class="child-age">Age: ${child.age}</span>
                        </div>
                    </div>
                    <div class="status-badge ${isOnline ? 'active' : 'offline'}">
                        ${isOnline ? 'Online' : 'Offline'}
                    </div>
                </div>
                
                <div class="child-stats">
                    <div class="stat">
                        <span class="stat-label">Last Active</span>
                        <span class="stat-value">${this.formatLastActive(child.last_activity)}</span>
                    </div>
                    <div class="stat">
                        <span class="stat-label">Username</span>
                        <span class="stat-value">${child.username}</span>
                    </div>
                </div>
    
                <div class="card-actions">
                    <button class="action-btn view-btn" data-child-id="${child.id}" title="View Profile">
                        <i class="fas fa-eye"></i> View
                    </button>
                    <button class="action-btn edit-btn" data-child-id="${child.id}" title="Edit Account">
                        <i class="fas fa-edit"></i> Edit
                    </button>
                    <button class="action-btn settings-btn" data-child-id="${child.id}" title="Account Settings">
                        <i class="fas fa-cog"></i> Settings
                    </button>
                    <button class="action-btn delete-btn" data-child-id="${child.id}" title="Delete Account">
                        <i class="fas fa-trash"></i> Delete
                    </button>
                </div>
            </div>
        `;
    }

    // Modal Management Methods
    showAddChildModal(existingChild = null) {
        this.removeExistingModals();
        
        const uniquePrefix = `child_form_${Date.now()}`;
        const modalElement = document.createElement('div');
        modalElement.innerHTML = this.getModalHtml(uniquePrefix, existingChild);
        document.body.appendChild(modalElement.firstElementChild);

        const modal = document.querySelector('.modal-overlay');
        this.setupModalEventListeners(modal, uniquePrefix, existingChild);
        
        requestAnimationFrame(() => modal.classList.add('show'));
    }

    setupModalEventListeners(modal, uniquePrefix, existingChild) {
        const form = document.getElementById(`${uniquePrefix}_form`);
        const closeBtn = modal.querySelector('.modal-close');
        const cancelBtn = document.getElementById(`${uniquePrefix}_cancel`);
        const passwordToggle = modal.querySelector('.toggle-password');
        const passwordInput = document.getElementById(`${uniquePrefix}_password`);

        closeBtn.addEventListener('click', () => this.closeModal(modal));
        cancelBtn.addEventListener('click', () => this.closeModal(modal));
        modal.addEventListener('click', (e) => {
            if (e.target === modal) this.closeModal(modal);
        });

        passwordToggle.addEventListener('click', () => {
            const type = passwordInput.type === 'password' ? 'text' : 'password';
            passwordInput.type = type;
            passwordToggle.querySelector('i').classList.toggle('fa-eye');
            passwordToggle.querySelector('i').classList.toggle('fa-eye-slash');
        });

        form.addEventListener('submit', (e) => {
            if (existingChild) {
                this.handleEditChild(e, modal, existingChild.id);
            } else {
                this.handleAddChild(e, modal);
            }
        });
    }

    getModalHtml(uniquePrefix, existingChild) {
        return `
            <div class="modal-overlay">
                <div class="modal-container">
                    <div class="modal-header">
                        <h2><i class="fas fa-child"></i> ${existingChild ? 'Edit' : 'Add'} Child Account</h2>
                        <button class="modal-close" aria-label="Close modal">&times;</button>
                    </div>
                    
                    <div class="modal-content">
                        <form id="${uniquePrefix}_form" class="child-account-form">
                            ${existingChild ? `<input type="hidden" name="childId" value="${existingChild.id}">` : ''}
                            
                            ${this.getBasicInfoFormHtml(uniquePrefix, existingChild)}
                            ${this.getCredentialsFormHtml(uniquePrefix, existingChild)}
                            ${this.getParentalControlsFormHtml(uniquePrefix, existingChild)}

                            <div class="form-actions">
                                <button type="button" class="btn btn-secondary" id="${uniquePrefix}_cancel">
                                    <i class="fas fa-times"></i> Cancel
                                </button>
                                <button type="submit" class="btn btn-primary">
                                    <i class="fas fa-check"></i> ${existingChild ? 'Save Changes' : 'Create Account'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            </div>
        `;
    }

    getBasicInfoFormHtml(uniquePrefix, existingChild) {
        return `
            <div class="form-card">
                <div class="card-header">
                    <i class="fas fa-user"></i>
                    <h3>Basic Information</h3>
                </div>
                <div class="form-row">
                    <div class="form-field">
                        <label for="${uniquePrefix}_name">Child's Name</label>
                        <input type="text"
                               id="${uniquePrefix}_name"
                               name="name"
                               required
                               placeholder="Enter child's name"
                               value="${existingChild ? existingChild.name : ''}"
                               autocomplete="off">
                    </div>
                    <div class="form-field">
                        <label for="${uniquePrefix}_age">Age</label>
                        <input type="number"
                               id="${uniquePrefix}_age"
                               name="age"
                               min="5"
                               max="17"
                               required
                               placeholder="Age (5-17)"
                               value="${existingChild ? existingChild.age : ''}">
                    </div>
                </div>
            </div>
        `;
    }

    getCredentialsFormHtml(uniquePrefix, existingChild) {
        return `
            <div class="form-card">
                <div class="card-header">
                    <i class="fas fa-lock"></i>
                    <h3>Account Credentials</h3>
                </div>
                <div class="form-row">
                    <div class="form-field">
                        <label for="${uniquePrefix}_username">Username</label>
                        <input type="text"
                               id="${uniquePrefix}_username"
                               name="username"
                               required
                               placeholder="Choose a username"
                               value="${existingChild ? existingChild.username : ''}"
                               ${existingChild ? 'readonly' : ''}
                               autocomplete="off">
                        <span class="field-hint">This will be used to log in</span>
                    </div>
                </div>
                <div class="form-row">
                    <div class="form-field">
                        <label for="${uniquePrefix}_password">
                            ${existingChild ? 'New Password (leave blank to keep current)' : 'Password'}
                        </label>
                        <div class="password-input-group">
                            <input type="password"
                                   id="${uniquePrefix}_password"
                                   name="password"
                                   ${existingChild ? '' : 'required'}
                                   placeholder="${existingChild ? 'Enter new password (optional)' : 'Create a password'}">
                            <button type="button" class="toggle-password" aria-label="Toggle password visibility">
                                <i class="fas fa-eye"></i>
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }

    getParentalControlsFormHtml(uniquePrefix, existingChild) {
        return `
            <div class="form-card">
                <div class="card-header">
                    <i class="fas fa-shield-alt"></i>
                    <h3>Parental Controls</h3>
                </div>
                <div class="form-row">
                    <div class="form-field">
                        <label for="${uniquePrefix}_msg_limit">Daily Message Limit</label>
                        <input type="number"
                               id="${uniquePrefix}_msg_limit"
                               name="daily_message_limit"
                               min="10"
                               max="200"
                               value="${existingChild ? existingChild.parentalControls.dailyMessageLimit : '50'}"
                               required>
                        <span class="input-suffix">messages per day</span>
                    </div>
                </div>
                <div class="form-row">
                    <div class="form-field">
                        <label>Chat Time Restrictions</label>
                        <div class="time-range-group">
                            <div class="time-input">
                                <label for="${uniquePrefix}_start_time">From</label>
                                <input type="time"
                                       id="${uniquePrefix}_start_time"
                                       name="allowedStartTime"
                                       value="${existingChild ? existingChild.parentalControls.allowedStartTime : '09:00'}"
                                       required>
                            </div>
                            <div class="time-input">
                                <label for="${uniquePrefix}_end_time">To</label>
                                <input type="time"
                                       id="${uniquePrefix}_end_time"
                                       name="allowedEndTime"
                                       value="${existingChild ? existingChild.parentalControls.allowedEndTime : '21:00'}"
                                       required>
                            </div>
                        </div>
                    </div>
                </div>
                <div class="form-row">
                    <div class="form-field checkbox-field">
                        <label class="checkbox-label">
                            <input type="checkbox"
                                   id="${uniquePrefix}_filter"
                                   name="filterInappropriate"
                                   ${existingChild && existingChild.parentalControls.filterInappropriate ? 'checked' : 'checked'}>
                            <span class="checkbox-text">Filter Inappropriate Content</span>
                        </label>
                    </div>
                </div>
            </div>
        `;
    }

    showDeleteConfirmModal(childId, childName) {
        const modalHtml = `
            <div class="modal-overlay">
                <div class="modal-container">
                    <div class="modal-header">
                        <h2><i class="fas fa-exclamation-triangle text-red-500"></i> Delete Child Account</h2>
                        <button class="modal-close" aria-label="Close modal">&times;</button>
                    </div>
                    
                    <div class="modal-content">
                        <div class="warning-message">
                            <p>Are you sure you want to delete ${childName}'s account?</p>
                            <p class="text-red-500 mt-2">This will permanently delete:</p>
                            <ul class="ml-4 mt-2">
                                <li>• All account information</li>
                                <li>• Chat history and conversations</li>
                                <li>• Learning progress and memories</li>
                                <li>• Parental control settings</li>
                            </ul>
                            <p class="mt-4 font-bold">This action cannot be undone.</p>
                        </div>
                        
                        <div class="confirmation-input mt-4">
                            <label>Type "DELETE" to confirm:</label>
                            <input type="text"
                                   id="deleteConfirmInput"
                                   class="border rounded p-2 mt-2 w-full"
                                   placeholder="Type DELETE to confirm">
                        </div>

                        <div class="form-actions mt-6">
                            <button type="button" class="btn btn-secondary" data-close-modal>
                                Cancel
                            </button>
                            <button type="button"
                                    class="btn btn-danger"
                                    id="confirmDeleteBtn"
                                    disabled>
                                Delete Account
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        `;

        document.body.insertAdjacentHTML('beforeend', modalHtml);
        
        const modal = document.querySelector('.modal-overlay');
        const closeBtn = modal.querySelector('.modal-close');
        const cancelBtn = modal.querySelector('[data-close-modal]');
        const confirmBtn = modal.querySelector('#confirmDeleteBtn');
        const confirmInput = modal.querySelector('#deleteConfirmInput');
        
        requestAnimationFrame(() => modal.classList.add('show'));
        
        confirmInput.addEventListener('input', (e) => {
            confirmBtn.disabled = e.target.value !== 'DELETE';
        });
        
        confirmBtn.addEventListener('click', async () => {
            if (confirmInput.value === 'DELETE') {
                await this.deleteChildAccount(childId);
                this.closeModal(modal);
            }
        });
        
        closeBtn.addEventListener('click', () => this.closeModal(modal));
        cancelBtn.addEventListener('click', () => this.closeModal(modal));
        modal.addEventListener('click', (e) => {
            if (e.target === modal) this.closeModal(modal);
        });
    }

    // Utility Methods
    attachCardEventListeners() {
        // View buttons
        document.querySelectorAll('.view-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const childId = e.currentTarget.dataset.childId;
                const chatsSection = document.querySelector('[data-section="chats"]');
                if (chatsSection) chatsSection.click();
                const chatChildFilter = document.getElementById('chatChildFilter');
                if (chatChildFilter) {
                    chatChildFilter.value = childId;
                    chatChildFilter.dispatchEvent(new Event('change'));
                }
            });
        });
    
        // Edit buttons
        document.querySelectorAll('.edit-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const childId = e.currentTarget.dataset.childId;
                this.editChild(childId);
            });
        });
    
        // Settings buttons
        document.querySelectorAll('.settings-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const childId = e.currentTarget.dataset.childId;
                const controlsSection = document.querySelector('[data-section="controls"]');
                if (controlsSection) controlsSection.click();
                const controlsChildFilter = document.getElementById('controlsChildFilter');
                if (controlsChildFilter) {
                    controlsChildFilter.value = childId;
                    controlsChildFilter.dispatchEvent(new Event('change'));
                }
            });
        });
    
        // Delete buttons
        document.querySelectorAll('.delete-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const childId = e.currentTarget.dataset.childId;
                const childCard = e.currentTarget.closest('.child-card');
                const childName = childCard.querySelector('.child-details h3').textContent;
                this.showDeleteConfirmModal(childId, childName);
            });
        });
    }

    getFormData(form, isEdit = false) {
        const formData = new FormData(form);
        const data = {
            name: formData.get('name'),
            age: parseInt(formData.get('age')),
            parentalControls: {
                filterInappropriate: formData.get('filterInappropriate') === 'on',
                dailyMessageLimit: parseInt(formData.get('daily_message_limit')),
                allowedStartTime: formData.get('allowedStartTime'),
                allowedEndTime: formData.get('allowedEndTime')
            }
        };

        if (!isEdit) {
            data.username = formData.get('username');
            data.password = formData.get('password');
        } else if (formData.get('password')) {
            data.password = formData.get('password');
        }

        return data;
    }

    showMessage(message, type = 'error') {
        const messageDiv = document.createElement('div');
        messageDiv.className = `${type}-message`;
        messageDiv.textContent = message;
        document.body.appendChild(messageDiv);
        setTimeout(() => messageDiv.remove(), 3000);
    }

    showError(message) {
        this.showMessage(message, 'error');
    }

    showSuccess(message) {
        this.showMessage(message, 'success');
    }

    removeExistingModals() {
        document.querySelectorAll('.modal-overlay').forEach(modal => modal.remove());
    }

    closeModal(modal) {
        if (!modal) return;
        modal.classList.remove('show');
        setTimeout(() => modal.remove(), 300);
    }

    formatLastActive(timestamp) {
        const lastActive = new Date(timestamp);
        const now = new Date();
        const diffMinutes = Math.floor((now - lastActive) / (1000 * 60));

        if (diffMinutes < 1) return 'Just now';
        if (diffMinutes < 60) return `${diffMinutes}m ago`;
        if (diffMinutes < 1440) return `${Math.floor(diffMinutes / 60)}h ago`;
        return lastActive.toLocaleDateString();
    }

    formatDate(dateString) {
        return new Date(dateString).toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
            year: 'numeric'
        });
    }
}

document.addEventListener('DOMContentLoaded', () => {
    window.childAccountManager = new ChildAccountManager();
});
