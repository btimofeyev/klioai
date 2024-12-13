class ParentalControls {
    constructor() {
        this.currentChildId = null;
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
            // Optional: show a notification to the user
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
            // Optional: show a notification to the user
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
            // Optional: show a notification to the user
        }
    }

    updateUI(controls) {
        this.elements.filterInappropriate.checked = controls.filterInappropriate;
        this.elements.blockPersonalInfo.checked = controls.blockPersonalInfo;
        this.elements.messageLimit.value = controls.messageLimit.toString();
        this.elements.allowedStartTime.value = controls.allowedHours.start;
        this.elements.allowedEndTime.value = controls.allowedHours.end;
    }

    async saveControls() {
        try {
            const controls = {
                filterInappropriate: this.elements.filterInappropriate.checked,
                blockPersonalInfo: this.elements.blockPersonalInfo.checked,
                messageLimit: parseInt(this.elements.messageLimit.value),
                allowedHours: {
                    start: this.elements.allowedStartTime.value,
                    end: this.elements.allowedEndTime.value
                }
            };

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

            alert('Parental controls updated successfully!');
        } catch (error) {
            alert('Failed to update parental controls. Please try again.');
        }
    }

    resetForm() {
        this.currentChildId = null;
        this.elements.filterInappropriate.checked = true;
        this.elements.blockPersonalInfo.checked = true;
        this.elements.messageLimit.value = '50';
        this.elements.allowedStartTime.value = '09:00';
        this.elements.allowedEndTime.value = '21:00';
    }
}

document.addEventListener('DOMContentLoaded', () => {
    if (document.getElementById('controls')) {
        new ParentalControls();
    }
});
