document.addEventListener('DOMContentLoaded', function() {
    const mobileMenuToggle = document.getElementById('mobileMenuToggle');
    const sidebar = document.querySelector('.sidebar');
    const closeSidebarBtn = document.getElementById('closeSidebar');
    const mainContent = document.querySelector('.main-content');

    // Function to toggle sidebar
    function toggleSidebar() {
        sidebar.classList.toggle('active');
    }

    // Toggle sidebar when menu button is clicked
    mobileMenuToggle.addEventListener('click', toggleSidebar);

    // Close sidebar when clicking outside
    mainContent.addEventListener('click', function(e) {
        if (sidebar.classList.contains('active')) {
            toggleSidebar();
        }
    });

    // Handle menu item clicks on mobile
    const menuItems = document.querySelectorAll('.menu-item');
    menuItems.forEach(item => {
        item.addEventListener('click', function() {
            if (window.innerWidth <= 768) {
                toggleSidebar();
            }
        });
    });

    // Close sidebar on window resize if width becomes larger than mobile breakpoint
    window.addEventListener('resize', function() {
        if (window.innerWidth > 768 && sidebar.classList.contains('active')) {
            sidebar.classList.remove('active');
        }
    });
});
