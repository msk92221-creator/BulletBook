package kr.co.bulletbook.app;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import org.json.JSONArray;
import org.json.JSONObject;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.time.LocalDate;
import java.time.temporal.ChronoUnit;
import java.util.Iterator;
import java.util.UUID;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/** The login is device-only and Keystore protected; it never enters a notebook backup. */
final class FamilyCalendarStore {
    private static final String KEY = "bulletbook_family_login_v1";
    static SharedPreferences prefs(Context context) {
        return context.getSharedPreferences("bulletbook_family", Context.MODE_PRIVATE);
    }
    private static SecretKey key() throws Exception {
        KeyStore store=KeyStore.getInstance("AndroidKeyStore"); store.load(null);
        SecretKey found=(SecretKey)store.getKey(KEY,null);
        if(found!=null)return found;
        KeyGenerator generator=KeyGenerator.getInstance("AES","AndroidKeyStore");
        generator.init(new KeyGenParameterSpec.Builder(KEY,KeyProperties.PURPOSE_ENCRYPT|KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build());
        return generator.generateKey();
    }
    private static String encrypt(JSONObject session) throws Exception {
        Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding");cipher.init(Cipher.ENCRYPT_MODE,key());
        byte[] bytes=cipher.doFinal(session.toString().getBytes(StandardCharsets.UTF_8));
        return Base64.encodeToString(cipher.getIV(),Base64.NO_WRAP)+":"+Base64.encodeToString(bytes,Base64.NO_WRAP);
    }
    static synchronized JSONObject session(Context context) throws Exception {
        String stored=prefs(context).getString("session","");if(stored.isEmpty())return null;
        String[] parts=stored.split(":",2);
        Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.DECRYPT_MODE,key(),new GCMParameterSpec(128,Base64.decode(parts[0],Base64.NO_WRAP)));
        return new JSONObject(new String(cipher.doFinal(Base64.decode(parts[1],Base64.NO_WRAP)),StandardCharsets.UTF_8));
    }
    static synchronized void configure(Context context,JSONObject payload) throws Exception {
        if(payload.optBoolean("disconnected")){clear(context);return;}
        JSONObject session=payload.getJSONObject("session");
        // API endpoints are fixed to the existing FamilyTeamRoom project.
        if(!"familyteamroom".equals(session.getString("projectId")))throw new IllegalArgumentException("Unknown project");
        if(!session.getString("uid").matches("[A-Za-z0-9_-]{1,128}") ||
           !session.getString("familyId").matches("[A-Za-z0-9_-]{1,128}"))throw new IllegalArgumentException("Invalid account");
        String scope=session.getString("uid")+":"+session.getString("familyId");
        SharedPreferences.Editor editor=prefs(context).edit();
        String localDays=prefs(context).getString("localDays","{}");
        if(!scope.equals(prefs(context).getString("scope","")))editor.clear().putString("localDays",localDays);
        editor.putString("scope",scope).putString("revision",UUID.randomUUID().toString())
            .putString("session",encrypt(session)).putString("events",payload.getJSONArray("events").toString())
            .putString("categories",payload.getJSONArray("categories").toString()).apply();
        FamilyCalendarWorker.schedule(context);
    }
    static synchronized void clear(Context context) {
        prefs(context).edit().clear().apply();FamilyCalendarWorker.cancel(context);
        // A stale combined snapshot must never reveal private events after logout/revocation.
        SharedPreferences widget=context.getSharedPreferences(CalendarWidgetProvider.PREFS,Context.MODE_PRIVATE);
        try{
            JSONObject root=new JSONObject(widget.getString(CalendarWidgetProvider.SNAPSHOT_KEY,"{}"));
            if(root.optBoolean("familyConnected")){
                root.put("days",root.optJSONObject("localDays")).put("familyConnected",false);
                widget.edit().putString(CalendarWidgetProvider.SNAPSHOT_KEY,root.toString()).apply();
            }
        }catch(Exception ignored){}
    }
    static synchronized boolean commit(Context context,String revision,JSONObject session,JSONArray events,JSONArray categories) throws Exception {
        if(!revision.equals(prefs(context).getString("revision","")))return false;
        prefs(context).edit().putString("session",encrypt(session)).putString("events",events.toString())
            .putString("categories",categories.toString()).apply();return true;
    }
    static synchronized void clearIfCurrent(Context context,String revision) {
        if(revision.equals(prefs(context).getString("revision","")))clear(context);
    }
    static synchronized void saveLocalDays(Context context,JSONObject root) {
        JSONObject days=root.optJSONObject("localDays");
        if(root.optBoolean("familyConnected")&&days!=null)prefs(context).edit().putString("localDays",days.toString()).apply();
    }
    static JSONObject widgetDays(Context context,JSONObject root,LocalDate from,LocalDate to) throws Exception {
        SharedPreferences preferences=prefs(context);
        if(!preferences.contains("session"))return root.optJSONObject("days");
        JSONObject days=root.optBoolean("familyConnected")?root.optJSONObject("localDays"):null;
        if(days==null)days=new JSONObject(preferences.getString("localDays","{}"));
        JSONArray events=new JSONArray(preferences.getString("events","[]"));
        JSONArray categories=new JSONArray(preferences.getString("categories","[]"));
        JSONObject colors=new JSONObject();
        colors.put("family","#4555ce").put("personal","#8260be").put("school","#257763")
            .put("health","#bb5b3e").put("anniversary","#b37419");
        for(int i=0;i<categories.length();i++){
            JSONObject category=categories.getJSONObject(i);
            colors.put(category.getString("id"),category.optBoolean("deleted")?"#737b8c":category.optString("color","#737b8c"));
        }
        for(int i=0;i<events.length();i++){
            JSONObject event=events.optJSONObject(i);if(event==null)continue;
            try{
                LocalDate start=LocalDate.parse(event.getString("startDate")),end=LocalDate.parse(event.getString("endDate"));
                long span=ChronoUnit.DAYS.between(start,end);if(span<0||span>366)continue;
                String until=event.optString("repeatUntil"),repeat=event.optString("repeat","none");
                LocalDate stop=until.isEmpty()?to:LocalDate.parse(until);
                for(LocalDate day=from;!day.isAfter(to);day=day.plusDays(1)){
                    if(!occursOn(start,span,repeat,stop,day))continue;
                    String date=day.toString();JSONObject count=days.optJSONObject(date);
                    if(count==null){count=new JSONObject();days.put(date,count);}
                    count.put("open",count.optInt("open")+1);
                    JSONArray items=count.optJSONArray("items"),tints=count.optJSONArray("colors");
                    if(items==null){items=new JSONArray();count.put("items",items);}
                    if(tints==null){tints=new JSONArray();for(int n=0;n<items.length();n++)tints.put("#475569");count.put("colors",tints);}
                    if(items.length()<3){
                        String time=event.optBoolean("allDay")?"":event.optString("startTime")+" ";
                        items.put((event.optBoolean("isPrivate")?"🔒 ":"")+time+event.optString("title"));
                        tints.put(colors.optString(event.optString("category"),"#737b8c"));
                    }
                }
            }catch(Exception ignored){/* One malformed event must not blank the widget. */}
        }
        return days;
    }
    static boolean occursOn(LocalDate start,long span,String repeat,LocalDate stop,LocalDate day) {
        if("none".equals(repeat))return !day.isBefore(start)&&!day.isAfter(start.plusDays(span));
        for(LocalDate candidate=day.minusDays(span);!candidate.isAfter(day);candidate=candidate.plusDays(1)){
            if(candidate.isBefore(start)||candidate.isAfter(stop))continue;
            long diff=ChronoUnit.DAYS.between(start,candidate);
            if("daily".equals(repeat)||("weekly".equals(repeat)&&diff%7==0)||
               ("monthly".equals(repeat)&&candidate.getDayOfMonth()==start.getDayOfMonth())||
               ("yearly".equals(repeat)&&candidate.getMonth()==start.getMonth()&&candidate.getDayOfMonth()==start.getDayOfMonth()))return true;
        }
        return false;
    }
}
