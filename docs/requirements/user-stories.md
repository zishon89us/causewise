# MVP user stories

Status: draft for maintainer review · M1. Each story becomes one issue.

## US-1 Install beside Zabbix
As a Zabbix administrator I want to install causewise with one container
and one imported media type, so that setup takes minutes.
- Given a running Zabbix 7.0 or 8.0, when I start the container with a
  config file and import the provided webhook media type, then a test alert
  appears in causewise's log within 10 seconds.
- Given a missing or invalid config value, when the container starts, then
  it exits with a message naming the value.

## US-2 Form an incident from alerts
As an on-call engineer I want related alerts handled as one incident, so
that I get one message, not forty.
- Given alerts arriving within the settle window, when the window closes,
  then exactly one investigation starts.
- Given a new alert during an open incident, then it joins that incident
  and no second investigation starts unless the first has finished and the
  alert set has materially changed.
- Given Zabbix 8.0 has marked cause and symptom links, then they are passed
  to the investigator as hints and never treated as the answer.

## US-3 Investigate read-only
As an on-call engineer I want the service to check metrics, timing and
dependencies for me, so that I start from a diagnosis.
- Given an incident, when the investigation runs, then it uses only the
  read-only tools and stays within the query budget.
- Given the Zabbix API token has write permission, then no write call is
  made (verified by a test that records every API method called).
- Given the investigation ends, then its output validates against the
  diagnosis schema in `docs/design/diagnosis-schema.md`.

## US-4 Admit uncertainty
As an on-call engineer I want it to say when it does not know, so that I do
not chase a confident wrong answer.
- Given an incident whose cause is not visible in the data, then the
  verdict is `undetermined`, no host is blamed with high confidence, and
  the message lists what was ruled out.
- Given a harmless isolated alert, then the verdict is `benign`.

## US-5 Deliver to chat
As an on-call engineer I want the diagnosis in the chat I already use.
- Given a finished diagnosis and a configured Telegram or Slack target,
  then one message arrives containing cause, confidence, evidence,
  unrelated alerts and ruled-out items.
- Given the chat service is unreachable, then delivery is retried with
  backoff and the failure is logged; the diagnosis is not lost.

## US-6 Ask a follow-up
As an on-call engineer I want to ask a follow-up question in the thread.
- Given a delivered diagnosis, when I reply with a question, then the
  answer uses fresh read-only queries and cites them.

## US-7 Acknowledge from chat (opt-in)
As an on-call engineer I want to acknowledge the problem from chat.
- Given acknowledge is not configured, then no acknowledge control is shown
  and no code path can write to Zabbix.
- Given it is configured with its own token, when I confirm, then the
  problems are acknowledged with my chat name in the comment.

## US-8 Bound the cost
As a team lead I want a cap on spend.
- Given a per-incident query and token budget, when it is reached, then the
  investigation stops and reports what it has, marked as incomplete.
- Given a daily budget is exhausted, then new incidents get an alerts-only
  summary marked as such.

## US-9 Keep names private
As a Zabbix administrator I want hostnames and IP addresses masked before
they leave the network.
- Given masking is on, then no real hostname or IP address appears in any
  request to the model provider (verified by a test on recorded requests),
  and the delivered message shows the real names.

## US-10 Audit
As a Zabbix administrator I want to see exactly what it queried.
- Given any diagnosis, then the queries it ran, with times and row counts,
  can be listed from the local store.

## US-11 Rate a diagnosis
As a team lead I want engineers to mark a diagnosis right or wrong, so that
accuracy on our own estate is known.
- Given a delivered diagnosis, when someone taps right or wrong, then the
  rating is stored with the incident and shown in a weekly summary.
