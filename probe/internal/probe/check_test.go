package probe_test

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/krmzv/pulsegram/probe/internal/probe"
)

func TestCheckURL_up(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()

	res := probe.CheckURL(srv.URL, 5000, true, "GET")
	if res.Status != "up" {
		t.Errorf("expected up, got %s (message: %v)", res.Status, res.Message)
	}
	if res.StatusCode == nil || *res.StatusCode != 200 {
		t.Errorf("expected status code 200")
	}
}

func TestCheckURL_serverError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer srv.Close()

	res := probe.CheckURL(srv.URL, 5000, true, "GET")
	if res.Status != "down" {
		t.Errorf("expected down, got %s", res.Status)
	}
	if res.StatusCode == nil || *res.StatusCode != 500 {
		t.Errorf("expected status code 500")
	}
}

func TestCheckURL_notFound(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNotFound)
	}))
	defer srv.Close()

	res := probe.CheckURL(srv.URL, 5000, true, "GET")
	if res.Status != "down" {
		t.Errorf("expected down for 404, got %s", res.Status)
	}
}

func TestCheckURL_redirect(t *testing.T) {
	final := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	defer final.Close()

	redirects := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, final.URL, http.StatusFound)
	}))
	defer redirects.Close()

	res := probe.CheckURL(redirects.URL, 5000, true, "GET")
	if res.Status != "up" {
		t.Errorf("expected up after redirect, got %s (message: %v)", res.Status, res.Message)
	}
}

func TestCheckURL_tooManyRedirects(t *testing.T) {
	// Server always redirects to itself.
	var srv *httptest.Server
	srv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, srv.URL, http.StatusFound)
	}))
	defer srv.Close()

	res := probe.CheckURL(srv.URL, 5000, true, "GET")
	if res.Status != "down" {
		t.Errorf("expected down for redirect loop, got %s", res.Status)
	}
}

func TestCheckURL_timeout(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Block until the client cancels (request context done).
		<-r.Context().Done()
	}))
	defer srv.Close()

	res := probe.CheckURL(srv.URL, 100, true, "GET") // 100ms timeout
	if res.Status != "down" {
		t.Errorf("expected down on timeout, got %s", res.Status)
	}
}

func TestCheckURL_ssrfBlocked(t *testing.T) {
	// Directly hitting 127.0.0.1 with allowPrivate=false must be blocked.
	res := probe.CheckURL("http://127.0.0.1:9999/", 5000, false, "GET")
	if res.Status != "down" {
		t.Errorf("expected down for SSRF target, got %s", res.Status)
	}
}

func TestCheckURL_headMethod(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodHead {
			w.WriteHeader(http.StatusMethodNotAllowed)
			return
		}
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()

	res := probe.CheckURL(srv.URL, 5000, true, "HEAD")
	if res.Status != "up" {
		t.Errorf("expected up for HEAD, got %s (message: %v)", res.Status, res.Message)
	}
}

func TestCheckURL_largeBody(t *testing.T) {
	// Response body larger than 256KB should be drained without error.
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write(make([]byte, 512*1024))
	}))
	defer srv.Close()

	res := probe.CheckURL(srv.URL, 5000, true, "GET")
	if res.Status != "up" {
		t.Errorf("expected up with large body, got %s", res.Status)
	}
}

func TestCheckURL_unreachable(t *testing.T) {
	res := probe.CheckURL("http://localhost:19999/", 500, true, "GET")
	if res.Status != "down" {
		t.Errorf("expected down for unreachable host, got %s", res.Status)
	}
}
