import { createClient } from "npm:@supabase/supabase-js@2.110.0";

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
  status: "processing";
  attempts: number;
  processing_token: string;
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
    case "event_waitlist_promoted": {
      const body = `<p style="line-height:1.65;">Hi ${escapeHtml(name)},</p>
        <p style="line-height:1.65;">Space is now available and your group has been moved from the waitlist to <strong>confirmed</strong>.</p>
        <p style="line-height:1.65;"><strong>${escapeHtml(eventTitle)}</strong><br>${escapeHtml(date)}<br>${escapeHtml(location)}<br>${escapeHtml(payload.participant_count)} attendee${Number(payload.participant_count) === 1 ? "" : "s"}</p>`;
      return {
        subject: `You're confirmed: ${eventTitle}`,
        html: pageShell("Waitlist update", "Your registration is confirmed", body, { label: "View your registration", url: `${siteUrl}dashboard.html` }),
        text: `Hi ${name},\n\nSpace is now available and your group has been moved from the waitlist to confirmed.\n\n${eventTitle}\n${date}\n${location}\n${payload.participant_count} attendee(s)\n\nPCA Youth Center`,
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
    case "volunteer_account_submitted_admin": {
      const applicantEmail = String(payload.email || "");
      const details = [
        `Name: ${name}`,
        `Email: ${applicantEmail}`,
        `Age: ${payload.age ?? "Not provided"}`,
        `Student phone: ${payload.phone || "Not provided"}`,
        `School: ${payload.school_name || "Not provided"}`,
      ];
      const body = `<p style="line-height:1.65;">A new Volunteer Account is ready for review.</p>
        <p style="line-height:1.65;">${details.map((line) => escapeHtml(line)).join("<br>")}</p>`;
      return {
        subject: `Volunteer Account review: ${name}`,
        html: pageShell("New Volunteer Account", name, body, { label: "Review account", url: `${siteUrl}admin-dashboard.html#teen-members` }),
        text: `A new Volunteer Account is ready for review.\n\n${details.join("\n")}`,
        replyTo: applicantEmail,
      };
    }
    case "volunteer_account_submitted_volunteer": {
      const body = `<p style="line-height:1.65;">Hi ${escapeHtml(name)},</p>
        <p style="line-height:1.65;">We received your PCA Volunteer Account application. An administrator will review it before assignments and service-hour tracking become available.</p>
        <p style="line-height:1.65;"><strong>Your application details</strong><br>Age: ${escapeHtml(payload.age)}<br>Student phone: ${escapeHtml(payload.phone)}<br>School: ${escapeHtml(payload.school_name)}</p>`;
      return {
        subject: "We received your PCA Volunteer Account application",
        html: pageShell("Volunteer Account", "Application received", body, { label: "Check application status", url: `${siteUrl}volunteer-dashboard.html` }),
        text: `Hi ${name},\n\nWe received your PCA Volunteer Account application. An administrator will review it before assignments and service-hour tracking become available.\n\nAge: ${payload.age}\nStudent phone: ${payload.phone}\nSchool: ${payload.school_name}`,
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

  let body: {
    kind?: string;
    resource_id?: string;
    retry_queued?: boolean;
    retry_promotions?: boolean;
    source_registration_id?: string;
    event_id?: string;
  };
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "A JSON request body is required." }, 400);
  }

  const processDelivery = async (deliveryId: string) => {
    const { data: currentState, error: stateError } = await adminClient
      .from("transactional_email_deliveries")
      .select("id,status,attempts,retry_not_after")
      .eq("id", deliveryId)
      .single();
    if (stateError || !currentState) {
      throw new Error(stateError?.message || "Queued email could not be found.");
    }
    if (currentState.status === "sent") {
      return { id: deliveryId, status: "sent", already_sent: true };
    }

    const resendKey = Deno.env.get("RESEND_API_KEY");
    const emailFrom = Deno.env.get("PCA_EMAIL_FROM");
    if (!resendKey || !emailFrom) {
      return { id: deliveryId, status: currentState.status, configured: false };
    }

    const { data: claimedRows, error: claimError } = await adminClient.rpc(
      "claim_transactional_email_delivery",
      { p_delivery_id: deliveryId },
    );
    if (claimError) throw new Error(claimError.message);

    const delivery = (Array.isArray(claimedRows) ? claimedRows[0] : null) as Delivery | undefined;
    if (!delivery) {
      const { data: latestState, error: latestStateError } = await adminClient
        .from("transactional_email_deliveries")
        .select("id,status,attempts,retry_not_after")
        .eq("id", deliveryId)
        .single();
      if (latestStateError || !latestState) {
        throw new Error(latestStateError?.message || "Email delivery state could not be read.");
      }
      if (latestState.status === "sent") {
        return { id: deliveryId, status: "sent", already_sent: true };
      }

      const retryWindowExpired = Boolean(
        latestState.retry_not_after
          && new Date(latestState.retry_not_after).getTime() <= Date.now(),
      );
      return {
        id: deliveryId,
        status: latestState.status,
        in_progress: latestState.status === "processing",
        retryable: latestState.attempts < 5 && !retryWindowExpired,
      };
    }

    const siteUrl = (Deno.env.get("PCA_SITE_URL") || "https://danielw412.github.io/New-PCA-website/").replace(/\/?$/, "/");
    const message = messageFor(delivery, siteUrl);

    try {
      const resendResponse = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${resendKey}`,
          "Content-Type": "application/json",
          "Idempotency-Key": `pca-email/${delivery.id}`,
        },
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

      const { data: completed, error: completionError } = await adminClient.rpc(
        "complete_transactional_email_delivery",
        {
          p_delivery_id: delivery.id,
          p_processing_token: delivery.processing_token,
          p_provider_message_id: String(resendBody?.id || ""),
        },
      );
      if (completionError || completed !== true) {
        throw new Error(completionError?.message || "The email was accepted, but its delivery record could not be finalized.");
      }
      return { id: delivery.id, status: "sent" };
    } catch (error) {
      const messageText = error instanceof Error ? error.message : "Email delivery failed.";
      const { error: failureError } = await adminClient.rpc(
        "fail_transactional_email_delivery",
        {
          p_delivery_id: delivery.id,
          p_processing_token: delivery.processing_token,
          p_error: messageText,
        },
      );
      if (failureError) console.error("Email delivery failure could not be recorded.", failureError);
      throw error;
    }
  };

  const listClaimableDeliveryIds = async (emailKind: string | null = null) => {
    const { data, error } = await adminClient.rpc(
      "list_claimable_transactional_email_deliveries",
      { p_email_kind: emailKind, p_limit: 25 },
    );
    if (error) throw error;
    return (Array.isArray(data) ? data : []).map((row) => String(row.id));
  };

  const processClaimableDeliveries = async (emailKind: string | null = null) => {
    const deliveryIds = await listClaimableDeliveryIds(emailKind);
    const results = [];
    for (const deliveryId of deliveryIds) {
      try {
        results.push(await processDelivery(deliveryId));
      } catch (error) {
        results.push({ id: deliveryId, status: "failed", error: error instanceof Error ? error.message : "Delivery failed." });
      }
    }
    return results;
  };

  const processInitialEventPromotions = async (eventId: string) => {
    const { data, error } = await adminClient.rpc(
      "list_initial_event_promotion_deliveries",
      { p_event_id: eventId, p_limit: 25 },
    );
    if (error) throw error;
    const results = [];
    for (const row of Array.isArray(data) ? data : []) {
      try {
        results.push(await processDelivery(String(row.id)));
      } catch (error) {
        results.push({ id: String(row.id), status: "failed", error: error instanceof Error ? error.message : "Delivery failed." });
      }
    }
    return results;
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

      const results = await processClaimableDeliveries();
      return jsonResponse({ processed: results.length, results });
    }

    if (body.retry_promotions) {
      const { data: userData, error: userError } = await userClient.auth.getUser();
      if (userError || !userData.user) return jsonResponse({ error: "Authentication is required." }, 401);

	  const { data: administrator } = await adminClient
		.from("admin_users")
		.select("user_id")
		.eq("user_id", userData.user.id)
		.maybeSingle();

	  if (administrator) {
		const results = await processClaimableDeliveries("event_waitlist_promoted");
		return jsonResponse({ processed: results.length, results });
	  }

	  const sourceRegistrationId = String(body.source_registration_id || "");
	  const eventId = String(body.event_id || "");
	  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
	  if (!uuidPattern.test(sourceRegistrationId) || !uuidPattern.test(eventId)) {
		return jsonResponse({ error: "A recent registration change is required." }, 403);
	  }

	  const { data: sourceRegistration, error: sourceError } = await adminClient
		.from("registrations")
		.select("account_id,event_id,updated_at")
		.eq("id", sourceRegistrationId)
		.maybeSingle();
	  const changedRecently = sourceRegistration?.updated_at
		&& Date.now() - new Date(sourceRegistration.updated_at).getTime() <= 5 * 60 * 1000;
	  if (
		sourceError
		|| !sourceRegistration
		|| sourceRegistration.account_id !== userData.user.id
		|| sourceRegistration.event_id !== eventId
		|| !changedRecently
	  ) {
		return jsonResponse({ error: "You cannot dispatch notifications for this registration." }, 403);
	  }

	  const results = await processInitialEventPromotions(eventId);
      return jsonResponse({ processed: results.length });
    }

    if (!body.kind || !body.resource_id) return jsonResponse({ error: "kind and resource_id are required." }, 400);

    if (body.kind === "volunteer_account_submitted") {
      const { data: deliveryIds, error: queueError } = await userClient.rpc("queue_volunteer_account_submission_emails", {
        p_application_id: body.resource_id,
      });
      if (queueError || !Array.isArray(deliveryIds) || !deliveryIds.length) {
        return jsonResponse({ error: queueError?.message || "Application emails could not be queued." }, 400);
      }
      const results = [];
      for (const deliveryId of deliveryIds) results.push(await processDelivery(String(deliveryId)));
      const queued = results.some((result) => result.status === "queued");
      return jsonResponse({ processed: results.length, results }, queued ? 202 : 200);
    }

    const { data: deliveryId, error: queueError } = await userClient.rpc("queue_transactional_email", {
      p_email_kind: body.kind,
      p_resource_id: body.resource_id,
    });
    if (queueError || !deliveryId) return jsonResponse({ error: queueError?.message || "Email could not be queued." }, 400);
    const result = await processDelivery(deliveryId);
    const responseStatus = ["queued", "processing"].includes(result.status)
      ? 202
      : result.status === "failed"
      ? 503
      : 200;
    return jsonResponse(result, responseStatus);
  } catch (error) {
    console.error(error);
    return jsonResponse({ error: error instanceof Error ? error.message : "Email delivery failed." }, 500);
  }
});
