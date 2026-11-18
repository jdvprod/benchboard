/* getfloorcall.com: old app links like getfloorcall.com/#/track go to the app, which has its own address now */
(function(){var a="%APP%";if(/^https:/.test(a)&&/^#\//.test(location.hash))location.replace(a+location.hash);})();
