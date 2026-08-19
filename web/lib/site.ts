// Sibling site. This forecaster predicts arrivals from weather; the dashboard observes
// the pool and reports live occupancy -- exactly the half this project deliberately
// cannot do. Every place the UI admits "we don't know how full it is" should point here.
//
// Keep in step with STATUS_DASHBOARD_URL / LIVE_OCCUPANCY_DAYS in api/main.py, which the
// assistant reads when it redirects an occupancy question.
export const STATUS_DASHBOARD_URL = "https://pondviewpool.vercel.app";

/** Live counting only runs these days, so the link is worth qualifying rather than
 *  sending someone to an empty dashboard on a Monday. */
export const LIVE_OCCUPANCY_DAYS = "Tuesdays, Wednesdays, Thursdays and Saturdays";
