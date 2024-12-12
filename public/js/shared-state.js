// shared-state.js
const SharedState = {
    currentSection: 'overview',
    childAccounts: [],
    selectedChild: null,
    userData: null,
};

// State update functions
function updateChildAccounts(children) {
    SharedState.childAccounts = children;
    // Trigger any necessary UI updates
    if (typeof updateChildSelect === 'function') {
        updateChildSelect();
    }
}

function getChildAccounts() {
    return SharedState.childAccounts;
}

function setSelectedChild(child) {
    SharedState.selectedChild = child;
}

function getSelectedChild() {
    return SharedState.selectedChild;
}

function setUserData(data) {
    SharedState.userData = data;
}

function getUserData() {
    return SharedState.userData;
}

// Export the state and functions
window.SharedState = SharedState;
window.updateChildAccounts = updateChildAccounts;
window.getChildAccounts = getChildAccounts;  // Fixed: was 'getChild'
window.setSelectedChild = setSelectedChild;
window.getSelectedChild = getSelectedChild;
window.setUserData = setUserData;
window.getUserData = getUserData;