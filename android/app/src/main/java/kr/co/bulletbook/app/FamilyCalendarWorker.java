package kr.co.bulletbook.app;

import android.content.Context;
import androidx.annotation.NonNull;
import androidx.work.Constraints;
import androidx.work.ExistingPeriodicWorkPolicy;
import androidx.work.NetworkType;
import androidx.work.PeriodicWorkRequest;
import androidx.work.WorkManager;
import androidx.work.Worker;
import androidx.work.WorkerParameters;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.Iterator;
import java.util.concurrent.TimeUnit;

/** Read-only background refresh using the signed-in user's Firebase rules. */
public final class FamilyCalendarWorker extends Worker {
    private static final String JOB="bulletbook-family-calendar";
    public FamilyCalendarWorker(@NonNull Context context,@NonNull WorkerParameters parameters){super(context,parameters);}
    static void schedule(Context context){
        WorkManager.getInstance(context).enqueueUniquePeriodicWork(JOB,ExistingPeriodicWorkPolicy.KEEP,
            new PeriodicWorkRequest.Builder(FamilyCalendarWorker.class,15,TimeUnit.MINUTES)
                .setConstraints(new Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()).build());
    }
    static void cancel(Context context){WorkManager.getInstance(context).cancelUniqueWork(JOB);}
    @NonNull @Override public Result doWork(){
        Context context=getApplicationContext();
        String revision=FamilyCalendarStore.prefs(context).getString("revision","");
        try{
            JSONObject session=FamilyCalendarStore.session(context);if(session==null)return Result.success();
            JSONObject refreshed=request("https://securetoken.googleapis.com/v1/token?key="+encode(session.getString("apiKey")),
                "grant_type=refresh_token&refresh_token="+encode(session.getString("refreshToken")),null);
            if(!session.getString("uid").equals(refreshed.getString("user_id")))throw new AccessException();
            String token=refreshed.getString("id_token");session.put("idToken",token).put("refreshToken",refreshed.getString("refresh_token"));
            String root="https://firestore.googleapis.com/v1/projects/familyteamroom/databases/(default)/documents/";
            String family="families/"+encode(session.getString("familyId"));
            JSONArray events=list(root+family+"/events",token);
            JSONArray personal=list(root+"users/"+encode(session.getString("uid"))+"/privateEvents",token);
            for(int i=0;i<personal.length();i++)events.put(personal.get(i));
            JSONArray categories=list(root+family+"/categories",token);
            if(FamilyCalendarStore.commit(context,revision,session,events,categories))CalendarWidgetProvider.refreshWidgets(context);
            return Result.success();
        }catch(AccessException denied){
            FamilyCalendarStore.clearIfCurrent(context,revision);CalendarWidgetProvider.refreshWidgets(context);return Result.success();
        }catch(Exception unavailable){return Result.retry();}
    }
    private static String encode(String value) throws Exception {return URLEncoder.encode(value,"UTF-8");}
    private static JSONObject request(String address,String form,String token) throws Exception {
        HttpURLConnection connection=(HttpURLConnection)new URL(address).openConnection();
        connection.setConnectTimeout(20000);connection.setReadTimeout(20000);connection.setInstanceFollowRedirects(false);
        try{
            if(token!=null)connection.setRequestProperty("Authorization","Bearer "+token);
            if(form!=null){connection.setRequestMethod("POST");connection.setDoOutput(true);
                connection.setRequestProperty("Content-Type","application/x-www-form-urlencoded");
                try(java.io.OutputStream stream=connection.getOutputStream()){stream.write(form.getBytes(StandardCharsets.UTF_8));}}
            int code=connection.getResponseCode();
            if(code==401||code==403||(form!=null&&code==400))throw new AccessException();
            if(code<200||code>=300)throw new java.io.IOException("Family refresh failed: "+code);
            try(InputStream input=connection.getInputStream();ByteArrayOutputStream output=new ByteArrayOutputStream()){
                byte[] buffer=new byte[8192];int length;
                while((length=input.read(buffer))!=-1){output.write(buffer,0,length);if(output.size()>16*1024*1024)throw new java.io.IOException("Response too large");}
                return new JSONObject(output.toString("UTF-8"));
            }
        }finally{connection.disconnect();}
    }
    private static JSONArray list(String address,String token) throws Exception {
        JSONArray result=new JSONArray();String cursor="";
        do{
            JSONObject page=request(address+"?pageSize=1000"+(cursor.isEmpty()?"":"&pageToken="+encode(cursor)),null,token);
            JSONArray docs=page.optJSONArray("documents");
            if(docs!=null)for(int i=0;i<docs.length();i++){
                JSONObject document=docs.getJSONObject(i),fields=document.optJSONObject("fields"),event=new JSONObject();
                if(fields==null)continue;
                for(Iterator<String> names=fields.keys();names.hasNext();){String name=names.next();event.put(name,decode(fields.getJSONObject(name)));}
                String path=document.getString("name");event.put("id",path.substring(path.lastIndexOf('/')+1));result.put(event);
            }
            cursor=page.optString("nextPageToken","");
        }while(!cursor.isEmpty());
        return result;
    }
    private static Object decode(JSONObject value) throws Exception {
        if(value.has("stringValue"))return value.getString("stringValue");
        if(value.has("booleanValue"))return value.getBoolean("booleanValue");
        if(value.has("integerValue"))return value.getLong("integerValue");
        if(value.has("arrayValue")){JSONArray values=value.getJSONObject("arrayValue").optJSONArray("values"),output=new JSONArray();
            if(values!=null)for(int i=0;i<values.length();i++)output.put(decode(values.getJSONObject(i)));return output;}
        return JSONObject.NULL;
    }
    private static final class AccessException extends Exception {}
}
