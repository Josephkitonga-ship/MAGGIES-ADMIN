/* ===========================================================
   MAGGIE'S COLLECTION — staff desks — js/request.js
   "Request access": makes a login and emails a confirmation
   link. The login can see and change NOTHING until the owner
   approves it in the Staff tab. Safe to leave open: it only
   creates an empty account.
   =========================================================== */

(function () {
  "use strict";

  const $ = (sel) => document.querySelector(sel);

  const KEYS_READY =
    window.SUPABASE_URL.indexOf("YOUR-PROJECT-REF") === -1 &&
    window.SUPABASE_ANON_KEY.indexOf("YOUR-ANON") === -1;
  const sb = (KEYS_READY && window.supabase)
    ? window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY)
    : null;

  function note(text, good) {
    const el = $("#reqMsg");
    el.className = "admin-msg " + (good ? "is-good" : "is-bad");
    el.textContent = text;
  }

  async function request(event) {
    event.preventDefault();
    if (!sb) { note("This page is not connected yet. Please try again later.", false); return; }

    const email = $("#reqEmail").value.trim();
    const a = $("#reqPassword").value;
    const b = $("#reqPassword2").value;
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { note("Enter a valid email address.", false); return; }
    if (a.length < 8) { note("Use at least 8 characters for the password.", false); return; }
    if (a !== b) { note("The two passwords do not match.", false); return; }

    note("Sending your request…", true);
    const { error } = await sb.auth.signUp({
      email: email,
      password: a,
      options: { emailRedirectTo: location.origin + location.pathname.replace(/[^/]*$/, "index.html") }
    });
    if (error) {
      note(/rate|limit|seconds/i.test(error.message)
        ? "Too many requests just now. Wait a few minutes and try again."
        : "Could not send the request: " + error.message, false);
      return;
    }
    /* same answer whether or not the email already has a login */
    $("#requestForm").reset();
    note("Almost there. Check your email and tap the confirmation link. Then ask the owner to approve you, and sign in.", true);
  }

  document.addEventListener("DOMContentLoaded", () => {
    $("#requestForm").addEventListener("submit", request);
  });
})();
