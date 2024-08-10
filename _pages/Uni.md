---
layout: archive
title: "Uni"
permalink: /Uni_Course/
author_profile: true
---

{% if site.author.googlescholar %}
  <div class="wordwrap">Personal Uni Course Notes</div>
{% endif %}

{% include base_path %}

{% for post in site.publications reversed %}
  {% include archive-single.html %}
{% endfor %}
