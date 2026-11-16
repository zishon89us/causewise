// Zabbix webhook media type script for causewise.
// Runs inside Zabbix (Duktape, ES5). Posts one alert to the causewise
// receiver. Parameters are defined on the media type; see docs/install.md.
var p = JSON.parse(value);

var required = ['url', 'secret', 'event_id', 'event_value', 'event_name', 'host'];
for (var i = 0; i < required.length; i++) {
    if (!p[required[i]]) {
        throw 'causewise: parameter "' + required[i] + '" is empty';
    }
}

var request = new HttpRequest();
request.addHeader('Content-Type: application/json');
request.addHeader('X-Causewise-Secret: ' + p.secret);

var response = request.post(p.url, JSON.stringify({
    event_id: p.event_id,
    event_value: p.event_value,
    event_update_status: p.event_update_status,
    event_name: p.event_name,
    severity: p.severity,
    host: p.host,
    trigger_id: p.trigger_id,
    tags: p.tags
}));

if (request.getStatus() !== 200) {
    throw 'causewise: receiver answered ' + request.getStatus() + ': ' + response;
}
return 'OK';
