// "Send feedback": visitors can report problems or suggest things. Messages are emailed to the owner
// through Web3Forms (https://web3forms.com). The access key below only allows sending messages to the
// owner's inbox; the owner's email address itself is kept at Web3Forms and never appears on the site.
export const WEB3FORMS_KEY = "";   // ← the access key from Web3Forms

const $ = id => document.getElementById(id);
let h = null;   // helpers from app.js: toast, getUser

export function init(helpers) {
  h = helpers;
  if (!$("feedbackModal")) return;
  $("menuFeedback").onclick = open;
  $("fbClose").onclick = close;
  $("feedbackModal").onclick = e => { if (e.target === $("feedbackModal")) close(); };
  document.addEventListener("keydown", e => { if (e.key === "Escape" && !$("feedbackModal").hidden) close(); });
  $("fbForm").onsubmit = e => { e.preventDefault(); send(); };
}

function open() {
  const u = h.getUser();
  $("fbEmail").value = u?.email || $("fbEmail").value;
  $("fbMsg").textContent = "";
  $("feedbackModal").hidden = false;
  setTimeout(() => $("fbText").focus(), 50);
}
const close = () => { $("feedbackModal").hidden = true; };

async function send() {
  const text = $("fbText").value.trim();
  if (text.length < 3) { $("fbText").focus(); return; }
  if ($("fbBot").checked) return close();   // hidden box that only spam robots tick
  if (!WEB3FORMS_KEY) { $("fbMsg").textContent = "Feedback isn't set up yet. Please try again later."; return; }
  const kind = $("fbKind").value, email = $("fbEmail").value.trim();
  const btn = $("fbSend"); btn.disabled = true; btn.textContent = "Sending…";
  try {
    const res = await fetch("https://api.web3forms.com/submit", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        access_key: WEB3FORMS_KEY,
        subject: `Discindex ${kind.toLowerCase()}: ${text.slice(0, 60)}`,
        from_name: "Discindex feedback",
        ...(email ? { email, replyto: email } : {}),
        type: kind,
        message: text,
        page: location.href,
        device: navigator.userAgent,
        signed_in: h.getUser() ? "yes" : "no",
      }),
    }).then(r => r.json());
    if (!res.success) throw new Error(res.message || "unknown error");
    $("fbText").value = "";
    close();
    h.toast("Thanks! Your message was sent 💌");
  } catch (e) {
    $("fbMsg").textContent = "Couldn't send it right now (" + e.message + "). Please try again in a moment.";
  }
  btn.disabled = false; btn.textContent = "Send";
}
