(function() {
  'use strict';

  window.triggerExplore = function() {
    if (window.DocChat && window.DocChat.runAudit) {
      window.DocChat.runAudit();
    }
  };
})();
