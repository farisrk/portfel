function ajax(config) {
    this.method = config.method || 'GET';
    this.payload = config.payload || null;
    var xhr = new XMLHttpRequest();
    xhr.open(this.method, config.url, true);
    xhr.upload.addEventListener("progress", function(e) {
        config.progress(e);
    });
    xhr.addEventListener("load", function() {
        config.success(xhr);
    });
    xhr.addEventListener("error", config.error);
    xhr.send(this.payload);
}
