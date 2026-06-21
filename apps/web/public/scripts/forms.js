(function () {
  const selector = "form[data-async-form]";
  const messages = {
    uk: {
      sending: "Надсилаємо...",
      success: "Дякуємо. Повідомлення надіслано.",
      error: "Не вдалося надіслати. Спробуйте ще раз або напишіть нам напряму.",
    },
    en: {
      sending: "Sending...",
      success: "Thank you. Your message has been sent.",
      error: "Could not send the message. Please try again or contact us directly.",
    },
  };

  function lang() {
    return (document.documentElement.lang || "uk").toLowerCase().startsWith("en") ? "en" : "uk";
  }

  function statusEl(form) {
    let el = form.querySelector("[data-form-status]");
    if (!el) {
      el = document.createElement("p");
      el.setAttribute("data-form-status", "1");
      el.setAttribute("role", "status");
      el.setAttribute("aria-live", "polite");
      el.className = "form-status";
      form.appendChild(el);
    }
    return el;
  }

  function setStatus(form, state, text) {
    const el = statusEl(form);
    el.hidden = false;
    el.textContent = text;
    el.className = "form-status form-status--" + state;
  }

  function payloadFrom(form) {
    const data = Object.fromEntries(new FormData(form).entries());
    data.formType = form.dataset.formType || data.formType || "contact";
    data.page = data.page || window.location.href;
    return data;
  }

  async function submitForm(event) {
    const form = event.target;
    if (!(form instanceof HTMLFormElement) || !form.matches(selector)) return;

    event.preventDefault();
    if (!form.reportValidity()) return;

    const copy = messages[lang()];
    const button = form.querySelector('[type="submit"]');
    const previousHtml = button ? button.innerHTML : "";

    if (button) {
      button.disabled = true;
      button.textContent = copy.sending;
    }
    setStatus(form, "loading", copy.sending);

    try {
      const response = await fetch(form.getAttribute("action") || "/api/contact", {
        method: "POST",
        headers: {
          "Accept": "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payloadFrom(form)),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || result.success === false) throw new Error(result.error || "Request failed");

      form.reset();
      form.dispatchEvent(new CustomEvent("avku:form-success", { bubbles: true }));
      setStatus(form, "success", copy.success);
    } catch {
      setStatus(form, "error", copy.error);
    } finally {
      if (button) {
        button.disabled = false;
        button.innerHTML = previousHtml;
      }
    }
  }

  document.addEventListener("submit", submitForm);
})();
