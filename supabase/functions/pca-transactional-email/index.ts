import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const jsonResponse = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" },
});

const escapeHtml = (value: unknown) => String(value ?? "")
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;")
  .replaceAll("'", "&#039;");

const formatEventDate = (value: unknown) => {
  const instant = new Date(String(value ?? ""));
  if (Number.isNaN(instant.getTime())) return "Date to be announced";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(instant);
};

type Delivery = {
  id: string;
  email_kind: string;
  resource_id: string;
  recipient: string;
  payload: Record<string, unknown>;
  status: "queued" | "processing" | "sent" | "failed";
  attempts: number;
};

type Message = {
  subject: string;
  html: string;
  text: string;
  replyTo?: string;
};

const pageShell = (eyebrow: string, heading: string, body: string, action?: { label: string; url: string }) => `
<!doctype html>
<html lang="en">
  <body style="margin:0;background:#f7f4f1;color:#16131a;font-family:Arial,sans-serif;">
    <div style="max-width:640px;margin:0 auto;padding:32px 20px;">
      <div style="background:#ffffff;border-top:5px solid #b31722;padding:32px;">
        <p style="margin:0 0 10px;color:#b31722;font-size:12px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;">${escapeHtml(eyebrow)}</p>
        <h1 style="margin:0 0 20px;font-family:Georgia,serif;font-size:30px;line-height:1.15;">${escapeHtml(heading)}</h1>
        ${body}
        ${action ? `<p style="margin:28px 0 0;"><a href="${escapeHtml(action.url)}" style="display:inline-block;background:#b31722;color:#ffffff;padding:12px 18px;text-decoration:none;font-weight:700;">${escapeHtml(action.label)}</a></p>` : ""}
      </div>
      <p style="margin:16px 0 0;color:#6c6260;font-size:12px;line-height:1.5;">PCA Youth Center · Pittsburgh, Pennsylvania · pcayouthcenter@gmail.com</p>
    </div>
  </body>
</html>`;

const messageFor = (delivery: Delivery, siteUrl: string): Message => {
  const payload = delivery.payload || {};
  const eventTitle = String(payload.event_title || "PCA event");
  const date = formatEventDate(payload.starts_at);
  const location = String(payload.location || "Location to be announced");
  const name = String(payload.full_name || payload.contact_name || "there");

  switch (delivery.email_kind) {
    case "event_registration_confirmation": {
      const waitlisted = payload.status === "waitlisted";
      const statusLine = waitlisted
        ? "Your group is on the waitlist. PCA will contact you if space becomes available."
        : "Your registration is confirmed.";
      const body = `<p style="line-height:1.65;">Hi ${escapeHtml(name)},</p>
        <p style="line-height:1.65;">${escapeHtml(statusLine)}</p>
        <p style="line-height:1.65;"><strong>${escapeHtml(eventTitle)}</strong><br>${escapeHtml(date)}<br>${escapeHtml(location)}<br>${escapeHtml(payload.participant_count)} attendee${Number(payload.participant_count) === 1 ? "" : "s"}</p>`;
      return {
        subject: `${waitlisted ? "Waitlist confirmation" : "Registration confirmation"}: ${eventTitle}`,
        html: pageShell("Event registration", eventTitle, body, { label: "View upcoming events", url: `${siteUrl}upcoming-events.html` }),
        text: `Hi ${name},\n\n${statusLine}\n\n${eventTitle}\n${date}\n${location}\n${payload.participant_count} attendee(s)\n\nPCA Youth Center`,
      };
    }
    case "volunteer_request_received": {
      const applicantEmail = String(payload.email || "");
      const details = [
        `Name: ${name}`,
        `Email: ${applicantEmail}`,
        `Age: ${payload.age ?? "—"}`,
        `Phone: ${payload.phone || "—"}`,
        `School / organization: ${payload.school_name || "—"}`,
        `Interests: ${payload.interests || "—"}`,
        `Availability: ${payload.availability || "—"}`,
      ];
      const body = `<p style="line-height:1.65;"><strong>${escapeHtml(eventTitle)}</strong><br>${escapeHtml(date)}<br>${escapeHtml(location)}</p>
        <p style="line-height:1.65;">${details.map((line) => escapeHtml(line)).join("<br>")}</p>`;
      return {
        subject: `Volunteer request: ${name} for ${eventTitle}`,
        html: pageShell("New volunteer request", name, body, { label: "Review request", url: `${siteUrl}admin-dashboard.html#volunteer-requests` }),
        text: `${eventTitle}\n${date}\n${location}\n\n${details.join("\n")}`,
        replyTo: applicantEmail,
      };
    }
    case "volunteer_request_approved": {
      const notes = String(payload.admin_notes || "").trim();
      const body = `<p style="line-height:1.65;">Hi ${escapeHtml(name)},</p>
        <p style="line-height:1.65;">Your request to volunteer at <strong>${escapeHtml(eventTitle)}</strong> has been approved.</p>
        <p style="line-height:1.65;">${escapeHtml(date)}<br>${escapeHtml(location)}</p>
        ${notes ? `<p style="line-height:1.65;"><strong>Message from PCA:</strong><br>${escapeHtml(notes)}</p>` : ""}
        <p style="line-height:1.65;">You do not need an account to volunteer. Create a Volunteer Account only if you want PCA to track and review your service hours.</p>`;
      return {
        subject: `Approved to volunteer: ${eventTitle}`,
        html: pageShell("Volunteer approval", `You're approved, ${name}`, body, { label: "Volunteer Account options", url: `${siteUrl}volunteer.html` }),
        text: `Hi ${name},\n\nYour request to volunteer at ${eventTitle} has been approved.\n${date}\n${location}${notes ? `\n\nMessage from PCA: ${notes}` : ""}\n\nYou only need a Volunteer Account if you want PCA to track your service hours.`,
      };
    }
    case "volunteer_account_approved": {
      const notes = String(payload.admin_notes || "").trim();
      const body = `<p style="line-height:1.65;">Hi ${escapeHtml(name)},</p>
        <p style="line-height:1.65;">Your PCA Volunteer Account has been approved. You can now view assignments and use hour tracking from your dashboard.</p>
        ${notes ? `<p style="line-height:1.65;"><strong>Message from PCA:</strong><br>${escapeHtml(notes)}</p>` : ""}`;
      return {
        subject: "Your PCA Volunteer Account is approved",
        html: pageShell("Volunteer Account", "Your account is approved", body, { label: "Open Volunteer Dashboard", url: `${siteUrl}volunteer-dashboard.html` }),
        text: `Hi ${name},\n\nYour PCA Volunteer Account has been approved. You can now view assignments and track service hours.${notes ? `\n\nMessage from PCA: ${notes}` : ""}`,
      };
    }
    default:
      throw new Error("Unsupported email template.");
  }
};

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return jsonResponse({ error: "Method not allowed." }, 405);

  const authorization = request.headers.get("Authorization");
  if (!authorization) return jsonResponse({ error: "Authentication is required." }, 401);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return jsonResponse({ error: "The email service is not configured." }, 503);
  }

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  let body: { kind?: string; resource_id?: string; retry_queued?: boolean };
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "A JSON request body is required." }, 400);
  }

  const processDelivery = async (deliveryId: string) => {
    const { data, error } = await adminClient
      .from("transactional_email_deliveries")
      .select("id,email_kind,resource_id,recipient,payload,status,attempts")
      .eq("id", deliveryId)
      .single();
    if (error || !data) throw new Error(error?.message || "Queued email could not be found.");
    const delivery = data as Delivery;
    if (delivery.status === "sent") return { id: delivery.id, status: "sent", already_sent: true };

    const resendKey = Deno.env.get("RESEND_API_KEY");
    const emailFrom = Deno.env.get("PCA_EMAIL_FROM");
    if (!resendKey || !emailFrom) {
      return { id: delivery.id, status: "queued", configured: false };
    }

    const siteUrl = (Deno.env.get("PCA_SITE_URL") || "https://danielw412.github.io/New-PCA-website/").replace(/\/?$/, "/");
    const message = messageFor(delivery, siteUrl);
    await adminClient
      .from("transactional_email_deliveries")
      .update({ status: "processing", attempts: delivery.attempts + 1, last_error: null })
      .eq("id", delivery.id);

    try {
      const resendResponse = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: emailFrom,
          to: [delivery.recipient],
          subject: message.subject,
          html: message.html,
          text: message.text,
          ...(message.replyTo ? { reply_to: message.replyTo } : {}),
        }),
      });
      const resendBody = await resendResponse.json().catch(() => ({}));
      if (!resendResponse.ok) throw new Error(String(resendBody?.message || `Email provider returned ${resendResponse.status}.`));
      await adminClient
        .from("transactional_email_deliveries")
        .update({ status: "sent", provider_message_id: resendBody?.id || null, sent_at: new Date().toISOString(), last_error: null })
        .eq("id", delivery.id);
      return { id: delivery.id, status: "sent" };
    } catch (error) {
      const messageText = error instanceof Error ? error.message : "Email delivery failed.";
      await adminClient
        .from("transactional_email_deliveries")
        .update({ status: "failed", last_error: messageText.slice(0, 2000) })
        .eq("id", delivery.id);
      throw error;
    }
  };

  try {
    if (body.retry_queued) {
      const { data: userData, error: userError } = await userClient.auth.getUser();
      if (userError || !userData.user) return jsonResponse({ error: "Authentication is required." }, 401);
      const { data: administrator } = await adminClient
        .from("admin_users")
        .select("user_id")
        .eq("user_id", userData.user.id)
        .maybeSingle();
      if (!administrator) return jsonResponse({ error: "Administrator access is required." }, 403);

      const { data: queued, error: queueError } = await adminClient
        .from("transactional_email_deliveries")
        .select("id")
        .in("status", ["queued", "failed"])
        .order("created_at", { ascending: true })
        .limit(25);
      if (queueError) throw queueError;
      const results = [];
      for (const item of queued || []) {
        try {
          results.push(await processDelivery(item.id));
        } catch (error) {
          results.push({ id: item.id, status: "failed", error: error instanceof Error ? error.message : "Delivery failed." });
        }
      }
      return jsonResponse({ processed: results.length, results });
    }

    if (!body.kind || !body.resource_id) return jsonResponse({ error: "kind and resource_id are required." }, 400);
    const { data: deliveryId, error: queueError } = await userClient.rpc("queue_transactional_email", {
      p_email_kind: body.kind,
      p_resource_id: body.resource_id,
    });
    if (queueError || !deliveryId) return jsonResponse({ error: queueError?.message || "Email could not be queued." }, 400);
    const result = await processDelivery(deliveryId);
    return jsonResponse(result, result.status === "queued" ? 202 : 200);
  } catch (error) {
    console.error(error);
    return jsonResponse({ error: error instanceof Error ? error.message : "Email delivery failed." }, 500);
  }
});
