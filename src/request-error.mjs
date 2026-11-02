/**
 * A request the server will not hand to branchling: a missing or malformed
 * parameter. A handler throws it BEFORE calling the adapter, so a bad request
 * costs no spawn, and the server answers with its status (4xx only) and
 * `{ error: { type, message } }`, like every other failure.
 *
 * Its own module so a view can import it without importing the server, which
 * imports the views.
 */

export class RequestError extends Error {
  constructor(message, { status = 400, type = "bad-request" } = {}) {
    super(message);
    if (!Number.isInteger(status) || status < 400 || status > 499) throw new RangeError(`RequestError status must be 4xx, got ${status}`);
    this.name = "RequestError";
    this.status = status;
    this.type = type;
  }
}
