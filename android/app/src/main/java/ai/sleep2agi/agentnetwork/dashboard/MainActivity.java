package ai.sleep2agi.agentnetwork.dashboard;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.Context;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.os.Bundle;
import android.view.Gravity;
import android.view.View;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;

public class MainActivity extends Activity {
    private static final String PREFS = "agent_network_dashboard";
    private static final String KEY_URL = "dashboard_url";
    private static final String KEY_USERNAME = "username";
    private static final String KEY_PASSWORD = "password";
    private static final String DEFAULT_URL = "http://dm.vansin.top:3000";

    private SharedPreferences prefs;
    private WebView webView;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        prefs = getSharedPreferences(PREFS, Context.MODE_PRIVATE);

        String url = prefs.getString(KEY_URL, "");
        if (url == null || url.trim().isEmpty()) {
            showSettings();
        } else {
            showDashboard(normalizeUrl(url));
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    private void showDashboard(String url) {
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(Color.rgb(12, 16, 18));

        LinearLayout bar = new LinearLayout(this);
        bar.setOrientation(LinearLayout.HORIZONTAL);
        bar.setGravity(Gravity.CENTER_VERTICAL);
        bar.setPadding(dp(12), dp(8), dp(8), dp(8));
        bar.setBackgroundColor(Color.rgb(18, 24, 28));

        TextView title = new TextView(this);
        title.setText(url);
        title.setTextColor(Color.WHITE);
        title.setSingleLine(true);
        title.setTextSize(13);
        bar.addView(title, new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1));

        Button settings = new Button(this);
        settings.setText("设置");
        settings.setAllCaps(false);
        settings.setOnClickListener(v -> showSettings());
        bar.addView(settings, new LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, dp(42)));

        webView = new WebView(this);
        WebSettings s = webView.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setLoadWithOverviewMode(true);
        s.setUseWideViewPort(true);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
        webView.setWebViewClient(new WebViewClient());

        root.addView(bar, new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT));
        root.addView(webView, new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 0, 1));
        setContentView(root);
        webView.loadUrl(url);
    }

    private void showSettings() {
        ScrollView scroll = new ScrollView(this);
        scroll.setFillViewport(true);
        scroll.setBackgroundColor(Color.rgb(12, 16, 18));

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setPadding(dp(22), dp(36), dp(22), dp(22));
        root.setBackgroundColor(Color.rgb(12, 16, 18));

        TextView heading = new TextView(this);
        heading.setText("Agent Network 设置");
        heading.setTextColor(Color.WHITE);
        heading.setTextSize(24);
        heading.setGravity(Gravity.START);
        root.addView(heading, new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT));

        TextView hint = new TextView(this);
        hint.setText("离线可用。填写 Dashboard 地址和登录账号，保存后会记录在本机。");
        hint.setTextColor(Color.rgb(180, 190, 190));
        hint.setTextSize(14);
        hint.setPadding(0, dp(8), 0, dp(20));
        root.addView(hint);

        EditText urlInput = input("Dashboard URL，例如 http://dm.vansin.top:3000", prefs.getString(KEY_URL, DEFAULT_URL));
        EditText userInput = input("用户名", prefs.getString(KEY_USERNAME, ""));
        EditText passInput = input("密码", prefs.getString(KEY_PASSWORD, ""));
        passInput.setInputType(0x00000081); // TYPE_CLASS_TEXT | TYPE_TEXT_VARIATION_PASSWORD

        root.addView(label("Dashboard 地址"));
        root.addView(urlInput);
        root.addView(label("用户名"));
        root.addView(userInput);
        root.addView(label("密码"));
        root.addView(passInput);

        Button save = new Button(this);
        save.setText("保存并打开");
        save.setAllCaps(false);
        save.setOnClickListener(v -> {
            String url = normalizeUrl(urlInput.getText().toString());
            if (!url.startsWith("http://") && !url.startsWith("https://")) {
                Toast.makeText(this, "请输入 http:// 或 https:// 开头的地址", Toast.LENGTH_LONG).show();
                return;
            }
            prefs.edit()
                .putString(KEY_URL, url)
                .putString(KEY_USERNAME, userInput.getText().toString())
                .putString(KEY_PASSWORD, passInput.getText().toString())
                .apply();
            showDashboard(url);
        });
        root.addView(save, new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(52)));

        if (prefs.getString(KEY_URL, "").length() > 0) {
            Button open = new Button(this);
            open.setText("不修改，直接打开");
            open.setAllCaps(false);
            open.setOnClickListener(v -> showDashboard(normalizeUrl(prefs.getString(KEY_URL, DEFAULT_URL))));
            root.addView(open, new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(52)));
        }

        scroll.addView(root, new ScrollView.LayoutParams(ScrollView.LayoutParams.MATCH_PARENT, ScrollView.LayoutParams.WRAP_CONTENT));
        setContentView(scroll);
    }

    private TextView label(String text) {
        TextView view = new TextView(this);
        view.setText(text);
        view.setTextColor(Color.rgb(210, 220, 220));
        view.setTextSize(13);
        view.setPadding(0, dp(10), 0, dp(6));
        return view;
    }

    private EditText input(String hint, String value) {
        EditText input = new EditText(this);
        input.setHint(hint);
        input.setText(value);
        input.setSingleLine(true);
        input.setTextColor(Color.WHITE);
        input.setHintTextColor(Color.rgb(130, 140, 140));
        input.setTextSize(16);
        input.setPadding(dp(12), 0, dp(12), 0);
        input.setMinHeight(dp(52));
        input.setBackgroundColor(Color.rgb(25, 33, 38));
        input.setSelectAllOnFocus(false);
        return input;
    }

    private String normalizeUrl(String raw) {
        String url = raw == null ? "" : raw.trim();
        if (url.length() == 0) return DEFAULT_URL;
        if (!url.startsWith("http://") && !url.startsWith("https://")) {
            url = "http://" + url;
        }
        return url;
    }

    private int dp(int value) {
        return (int) (value * getResources().getDisplayMetrics().density + 0.5f);
    }

    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) {
            webView.goBack();
            return;
        }
        super.onBackPressed();
    }
}
