package kr.co.bulletbook.app;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.net.Uri;
import android.view.View;
import android.widget.RemoteViews;

import org.json.JSONArray;
import org.json.JSONObject;

import java.time.LocalDate;
import java.time.YearMonth;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * 홈 화면 1개월 캘린더 위젯.
 *
 * 데이터는 MainActivity의 CloudAccountBridge가 SharedPreferences의
 * "calendar_widget_v1_json" 키로 저장한 위젯 전용 snapshot에서 읽는다.
 * snapshot 형식:
 *   {"version":2,"updatedAt":"...","days":{"2026-08-08":{
 *     "open":2,"completed":1,"items":["○ 일정","✓ 완료"]
 *   }}}
 *
 * 위젯은 보기 전용이며 날짜·월·오늘 클릭 시 MainActivity로 Intent를 보낸다.
 */
public class CalendarWidgetProvider extends AppWidgetProvider {

    static final String PREFS = "bulletbook_cloud";
    static final String SNAPSHOT_KEY = "calendar_widget_v1_json";
    private static final DateTimeFormatter ISO = DateTimeFormatter.ofPattern("yyyy-MM-dd");
    private static final DateTimeFormatter MONTH_LABEL =
        DateTimeFormatter.ofPattern("yyyy년 M월", Locale.KOREA);

    // 요일 헤더. 월요일 시작으로 앱의 주간 페이지 순서와 맞춘다.
    private static final String[] WEEKDAYS = {"월", "화", "수", "목", "금", "토", "일"};

    @Override
    public void onReceive(Context context, Intent intent) {
        super.onReceive(context, intent);
        if (Intent.ACTION_MY_PACKAGE_REPLACED.equals(intent.getAction())) {
            refreshWidgets(context);
        }
    }

    @Override
    public void onUpdate(Context context, AppWidgetManager manager, int[] ids) {
        for (int id : ids) {
            renderWidget(context, manager, id);
        }
        scheduleNextDayAlarm(context);
    }

    @Override
    public void onEnabled(Context context) {
        scheduleNextDayAlarm(context);
    }

    @Override
    public void onDisabled(Context context) {
        cancelNextDayAlarm(context);
    }

    /** JS bridge가 snapshot을 저장한 직후 호출한다. */
    static void refreshWidgets(Context context) {
        AppWidgetManager manager = AppWidgetManager.getInstance(context);
        ComponentName component = new ComponentName(context, CalendarWidgetProvider.class);
        int[] ids = manager.getAppWidgetIds(component);
        if (ids == null || ids.length == 0) return;
        for (int id : ids) {
            renderWidget(context, manager, id);
        }
    }

    private static void renderWidget(
        Context context, AppWidgetManager manager, int widgetId
    ) {
        RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.widget_calendar);

        DayCounts counts = loadSnapshot(context);
        LocalDate today = LocalDate.now();
        YearMonth month = YearMonth.from(today);

        views.setTextViewText(R.id.widget_month_label, month.format(MONTH_LABEL));

        // RemoteViews로 GridLayout에 0dp 칸을 동적으로 넣으면 일부 One UI
        // 런처에서 모든 칸이 0픽셀로 접힌다. 가중치가 있는 LinearLayout 행을
        // 사용해 7열 × 6행 크기를 런처와 관계없이 확정한다.
        views.removeAllViews(R.id.widget_weekday_row);
        for (String label : WEEKDAYS) {
            RemoteViews cell = new RemoteViews(
                context.getPackageName(), R.layout.widget_calendar_weekday_cell
            );
            cell.setTextViewText(R.id.widget_weekday_label, label);
            views.addView(R.id.widget_weekday_row, cell);
        }

        views.removeAllViews(R.id.widget_date_grid);
        List<LocalDate> dates = visibleDates(month);
        for (int week = 0; week < 6; week++) {
            RemoteViews row = new RemoteViews(
                context.getPackageName(), R.layout.widget_calendar_row
            );
            for (int weekday = 0; weekday < 7; weekday++) {
                LocalDate date = dates.get(week * 7 + weekday);
                String iso = date.format(ISO);
                RemoteViews cell = dateCell(
                    context,
                    date,
                    YearMonth.from(date).equals(month),
                    date.isEqual(today),
                    counts.days.get(iso)
                );
                cell.setOnClickPendingIntent(
                    R.id.widget_cell_root, datePendingIntent(context, date)
                );
                row.addView(R.id.widget_calendar_row, cell);
            }
            views.addView(R.id.widget_date_grid, row);
        }

        // 월 라벨 클릭 → 해당 월의 월간 페이지
        Intent monthIntent = new Intent(context, MainActivity.class);
        monthIntent.setAction(Intent.ACTION_VIEW);
        monthIntent.setData(Uri.parse("bulletbook://month/" + month.format(DateTimeFormatter.ofPattern("yyyy-MM"))));
        monthIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent monthPi = PendingIntent.getActivity(
            context, 900000 + month.getYear() * 12 + month.getMonthValue(), monthIntent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
        views.setOnClickPendingIntent(R.id.widget_month_label, monthPi);

        // 오늘 버튼 → 오늘 일간 페이지
        Intent todayIntent = new Intent(context, MainActivity.class);
        todayIntent.setAction(Intent.ACTION_VIEW);
        todayIntent.setData(Uri.parse("bulletbook://calendar/" + today.format(ISO)));
        todayIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent todayPi = PendingIntent.getActivity(
            context, (int) today.toEpochDay() + 1000000, todayIntent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
        views.setOnClickPendingIntent(R.id.widget_today_button, todayPi);

        manager.updateAppWidget(widgetId, views);
    }

    static List<LocalDate> visibleDates(YearMonth month) {
        LocalDate first = month.atDay(1);
        LocalDate start = first.minusDays(first.getDayOfWeek().getValue() - 1L);
        List<LocalDate> dates = new ArrayList<>(42);
        for (int index = 0; index < 42; index++) {
            dates.add(start.plusDays(index));
        }
        return dates;
    }

    private static PendingIntent datePendingIntent(Context context, LocalDate date) {
        String iso = date.format(ISO);
        Intent open = new Intent(context, MainActivity.class);
        open.setAction(Intent.ACTION_VIEW);
        open.setData(Uri.parse("bulletbook://calendar/" + iso));
        open.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        return PendingIntent.getActivity(
            context,
            (int) date.toEpochDay(),
            open,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
    }

    private static RemoteViews dateCell(
        Context context,
        LocalDate date,
        boolean isCurrentMonth,
        boolean isToday,
        DayCount count
    ) {
        RemoteViews cell = new RemoteViews(context.getPackageName(), R.layout.widget_calendar_cell);
        cell.setTextViewText(R.id.widget_cell_day, String.valueOf(date.getDayOfMonth()));
        if (isToday) {
            cell.setTextColor(R.id.widget_cell_day, Color.parseColor("#ffffff"));
            cell.setInt(R.id.widget_cell_day, "setBackgroundResource", R.drawable.widget_today_background);
        } else {
            cell.setTextColor(
                R.id.widget_cell_day,
                Color.parseColor(isCurrentMonth ? "#20201d" : "#9c978d")
            );
            cell.setInt(R.id.widget_cell_day, "setBackgroundResource", 0);
        }

        String summary = eventSummary(count);
        if (summary.isEmpty()) {
            cell.setViewVisibility(R.id.widget_cell_dots, View.GONE);
        } else {
            cell.setViewVisibility(R.id.widget_cell_dots, View.VISIBLE);
            cell.setTextViewText(R.id.widget_cell_dots, summary);
            cell.setTextColor(
                R.id.widget_cell_dots,
                Color.parseColor(isCurrentMonth ? "#504b43" : "#a39d92")
            );
        }
        return cell;
    }

    /** 일정 제목을 최대 세 줄로 만들고, 이전 snapshot이면 점으로 대체한다. */
    static String eventSummary(DayCount count) {
        if (count == null) return "";
        int open = count.open + count.migrated + count.scheduled;
        int completed = count.completed;
        int total = open + completed;
        if (total == 0) return "";
        if (!count.items.isEmpty()) {
            int shown = Math.min(count.items.size(), total > count.items.size() ? 2 : 3);
            StringBuilder summary = new StringBuilder();
            for (int index = 0; index < shown; index++) {
                if (summary.length() > 0) summary.append('\n');
                summary.append(count.items.get(index));
            }
            int remaining = total - shown;
            if (remaining > 0) summary.append("\n+").append(remaining);
            return summary.toString();
        }
        StringBuilder dots = new StringBuilder();
        for (int index = 0; index < Math.min(total, 3); index++) dots.append("●");
        if (total > 3) dots.append(' ').append(total);
        return dots.toString();
    }

    /** SharedPreferences에서 snapshot을 읽어 날짜별 카운트 맵으로 변환한다. */
    private static DayCounts loadSnapshot(Context context) {
        DayCounts result = new DayCounts();
        SharedPreferences prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        String json = prefs.getString(SNAPSHOT_KEY, "");
        if (json == null || json.isEmpty()) return result;
        try {
            JSONObject root = new JSONObject(json);
            JSONObject days = root.optJSONObject("days");
            if (days == null) return result;
            for (java.util.Iterator<String> it = days.keys(); it.hasNext(); ) {
                String key = it.next();
                JSONObject entry = days.optJSONObject(key);
                if (entry == null) continue;
                DayCount dc = new DayCount();
                dc.open = entry.optInt("open", 0);
                dc.completed = entry.optInt("completed", 0);
                dc.migrated = entry.optInt("migrated", 0);
                dc.scheduled = entry.optInt("scheduled", 0);
                JSONArray items = entry.optJSONArray("items");
                if (items != null) {
                    for (int index = 0; index < Math.min(items.length(), 3); index++) {
                        String item = items.optString(index, "").replaceAll("\\s+", " ").trim();
                        if (!item.isEmpty()) {
                            dc.items.add(item.substring(0, Math.min(item.length(), 80)));
                        }
                    }
                }
                result.days.put(key, dc);
            }
        } catch (Exception ignored) {
            // 손상된 snapshot은 빈 위젯으로 표시한다.
        }
        return result;
    }

    // ---- 자정 이후 갱신 (inexact alarm, 권한 불필요) ----

    private static final int ALARM_REQUEST_CODE = 0xB00C;

    private void scheduleNextDayAlarm(Context context) {
        AlarmManager am = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        if (am == null) return;
        LocalDate next = LocalDate.now().plusDays(1);
        long triggerAt = next.atStartOfDay(java.time.ZoneId.systemDefault())
            .toInstant().toEpochMilli() + 5 * 60 * 1000L; // 다음날 00:05 ± window
        Intent intent = new Intent(context, CalendarWidgetProvider.class);
        intent.setAction(AppWidgetManager.ACTION_APPWIDGET_UPDATE);
        PendingIntent pi = PendingIntent.getBroadcast(
            context, ALARM_REQUEST_CODE, intent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
        am.setWindow(AlarmManager.RTC, triggerAt, 30 * 60 * 1000L, pi);
    }

    private void cancelNextDayAlarm(Context context) {
        AlarmManager am = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        if (am == null) return;
        Intent intent = new Intent(context, CalendarWidgetProvider.class);
        intent.setAction(AppWidgetManager.ACTION_APPWIDGET_UPDATE);
        PendingIntent pi = PendingIntent.getBroadcast(
            context, ALARM_REQUEST_CODE, intent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
        am.cancel(pi);
    }

    // ---- snapshot 데이터 모델 ----

    static final class DayCounts {
        final Map<String, DayCount> days = new HashMap<>();
    }

    static final class DayCount {
        int open;
        int completed;
        int migrated;
        int scheduled;
        final List<String> items = new ArrayList<>();
    }
}
