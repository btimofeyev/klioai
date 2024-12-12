const Utils = {
  isAuthenticated() {
      return this.getAuthToken() !== null;
  },
  
  getAuthToken() {
      return localStorage.getItem('authToken');
  },
  
  getUserData() {
      const userData = localStorage.getItem('userData');
      return userData ? JSON.parse(userData) : null;
  },
  
  setAuthHeader(headers = {}) {
      const token = this.getAuthToken();
      if (token) {
          return {
              ...headers,
              'Authorization': `Bearer ${token}`,
              'Content-Type': 'application/json'
          };
      }
      return headers;
  },
  
  async fetchWithAuth(url, options = {}) {
      options.headers = this.setAuthHeader(options.headers);
      const response = await fetch(url, options);
      
      if (response.status === 401) {
          this.logout();
          return null;
      }
      
      return response;
  },
  
  logout() {
      localStorage.removeItem('authToken');
      localStorage.removeItem('userData');
      window.location.href = '/login.html';
  }
};

window.Utils = Utils;