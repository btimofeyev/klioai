// Updated ParentalControls class to fix the message limit validation issue
class ParentalControls {
    constructor() {
        this.currentChildId = null;
        this.validMessageLimits = [50, 100, 200, 999999]; // Match backend validation
        this.initializeElements();
        this.attachEventListeners();
    }

    initializeElements() {
        this.elements = {
            childSelect: document.getElementById('controlsChildFilter'),
            filterInappropriate: document.getElementById('filterInappropriate'),
            blockPersonalInfo: document.getElementById('blockPersonalInfo'),
            messageLimit: document.getElementById('messageLimit'),
            allowedStartTime: document.getElementById('allowedStartTime'),
            allowedEndTime: document.getElementById('allowedEndTime'),
            saveButton: document.getElementById('saveControls')
        };
        this.loadChildren();
    }

    async loadChildren() {
        try {
            const response = await fetch('/api/children', {
                headers: {
                    'Authorization': `Bearer ${localStorage.getItem('authToken')}`
                }
            });
            const data = await response.json();

            if (data.success && data.children) {
                this.elements.childSelect.innerHTML = `
                    <option value="">Select a child</option>
                    ${data.children.map(child => `<option value="${child.id}">${child.name}</option>`).join('')}
                `;
            }
        } catch (error) {
            this.showNotification('Failed to load children', 'error');
        }
    }

    attachEventListeners() {
        this.elements.childSelect.addEventListener('change', (e) => {
            const childId = e.target.value;
            if (childId) {
                this.currentChildId = childId;
                this.loadChildData(childId);
            } else {
                this.resetForm();
            }
        });

        this.elements.saveButton.addEventListener('click', () => this.saveControls());
    }

    async loadChildData(childId) {
        try {
            await this.loadChildControls(childId);
        } catch (error) {
            this.showNotification('Failed to load child controls', 'error');
        }
    }

    async loadChildControls(childId) {
        try {
            const response = await fetch(`/api/parental-controls/children/${childId}/controls`, {
                headers: {
                    'Authorization': `Bearer ${localStorage.getItem('authToken')}`
                }
            });
            const data = await response.json();
            if (data.success) {
                this.updateUI(data.controls);
            } else {
                throw new Error(data.message || 'Failed to load controls');
            }
        } catch (error) {
            this.showNotification('Failed to load controls: ' + error.message, 'error');
        }
    }

    updateUI(controls) {
        this.elements.filterInappropriate.checked = controls.filterInappropriate;
        this.elements.blockPersonalInfo.checked = controls.blockPersonalInfo;
        
        // Ensure the message limit is set to a valid value
        const messageLimitValue = controls.messageLimit.toString();
        const messageLimitOption = Array.from(this.elements.messageLimit.options)
            .find(option => option.value === messageLimitValue);
            
        if (messageLimitOption) {
            this.elements.messageLimit.value = messageLimitValue;
        } else {
            // If no matching option, select the closest valid option
            const closestLimit = this.findClosestValidLimit(controls.messageLimit);
            this.elements.messageLimit.value = closestLimit.toString();
            console.warn(`Message limit ${controls.messageLimit} not in dropdown. Using ${closestLimit} instead.`);
        }
        
        this.elements.allowedStartTime.value = controls.allowedHours.start;
        this.elements.allowedEndTime.value = controls.allowedHours.end;
    }

    findClosestValidLimit(limit) {
        // Find the closest valid message limit value
        return this.validMessageLimits.reduce((prev, curr) => 
            Math.abs(curr - limit) < Math.abs(prev - limit) ? curr : prev
        );
    }

    async saveControls() {
        try {
            if (!this.currentChildId) {
                this.showNotification('Please select a child first', 'error');
                return;
            }

            // Validate time format
            if (!this.validateTimeFormat(this.elements.allowedStartTime.value) || 
                !this.validateTimeFormat(this.elements.allowedEndTime.value)) {
                this.showNotification('Invalid time format. Please use HH:MM format.', 'error');
                return;
            }

            // Ensure message limit is one of the valid values
            const messageLimitValue = parseInt(this.elements.messageLimit.value, 10);
            if (!this.validMessageLimits.includes(messageLimitValue)) {
                this.showNotification('Invalid message limit value. Please select a valid option.', 'error');
                return;
            }

            const controls = {
                filterInappropriate: this.elements.filterInappropriate.checked,
                blockPersonalInfo: this.elements.blockPersonalInfo.checked,
                messageLimit: messageLimitValue,
                allowedHours: {
                    start: this.elements.allowedStartTime.value,
                    end: this.elements.allowedEndTime.value
                }
            };

            console.log('Sending controls data:', controls);

            const response = await fetch(`/api/parental-controls/children/${this.currentChildId}/controls`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${localStorage.getItem('authToken')}`
                },
                body: JSON.stringify(controls)
            });

            const data = await response.json();
            if (!data.success) {
                throw new Error(data.message || 'Failed to update controls');
            }

            this.showNotification('Parental controls updated successfully!', 'success');
        } catch (error) {
            console.error('Save controls error:', error);
            this.showNotification('Failed to update parental controls: ' + error.message, 'error');
        }
    }

    validateTimeFormat(timeStr) {
        // Basic validation for time format HH:MM
        return /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/.test(timeStr);
    }

    resetForm() {
        this.currentChildId = null;
        this.elements.filterInappropriate.checked = true;
        this.elements.blockPersonalInfo.checked = true;
        this.elements.messageLimit.value = '50';
        this.elements.allowedStartTime.value = '09:00';
        this.elements.allowedEndTime.value = '21:00';
    }

    showNotification(message, type = 'success') {
        // Check if a notification already exists and remove it
        const existingNotification = document.querySelector('.notification');
        if (existingNotification) {
            existingNotification.remove();
        }

        // Create and append the notification
        const notification = document.createElement('div');
        notification.className = `notification ${type}`;
        notification.textContent = message;
        
        document.body.appendChild(notification);
        
        // Remove the notification after 3 seconds
        setTimeout(() => notification.remove(), 3000);
    }
}

document.addEventListener('DOMContentLoaded', () => {
    if (document.getElementById('controls')) {
        new ParentalControls();
    }
});