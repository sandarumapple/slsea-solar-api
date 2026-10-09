The SLSEA Solar Generation API was developed using Node.js, Express and MongoDB to manage current and historical rooftop solar generation data. It organises installations by province, district and grid substation. SLSEA staff can view data within their assigned area, while devices can submit readings only for their own installation.

The API uses JWT authentication and checks each account’s permissions before allowing access. Users can view installations, retrieve the latest readings, filter historical data and access district generation summaries. Readings are append-only, and duplicate submissions are rejected. Swagger provides an interactive interface for exploring and testing the endpoints.

The sample database contains 200 installations and 134,600 synthetic readings covering seven days. These readings are for demonstration and do not update automatically. District summaries show recent power generation and estimated daily energy, excluding stale readings from current power totals.

The recorded test results show 53 tests passing on 8 October 2026, covering authentication, permissions, filtering, pagination and other API behaviour. Deployment configuration is prepared for Render, but public deployment still needs to be verified. Main limitations include estimated energy values, shared demo passwords and pagination that can shift when new readings are added.
