from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("circle", "0004_site_ai_key"),
    ]

    operations = [
        migrations.AddField(
            model_name="riskreport",
            name="checks",
            field=models.JSONField(default=list, verbose_name="排查清单"),
        ),
    ]
